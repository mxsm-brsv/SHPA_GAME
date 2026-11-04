-- v5: организаторы делят работу. Проверка заданий — «взять в работу» (сдача закрепляется на 10 минут),
-- зоны дежурства («кто на чём»), одна и та же отметка на блоке не открывается дважды.

-- ---------- Закрепление сдач за проверяющим ----------
alter table public.submissions add column if not exists claimed_by uuid references public.players(id) on delete set null;
alter table public.submissions add column if not exists claimed_at timestamptz;

/** Сколько минут сдача остаётся за тем, кто её взял. */
create or replace function public._claim_minutes() returns int language sql stable as $$ select 10 $$;

create or replace function public._claim_live(s public.submissions) returns boolean language sql stable as $$
  select s.claimed_by is not null and s.claimed_at > now() - make_interval(mins => _claim_minutes())
$$;

/** Взять в работу до p_n самых старых свободных сдач. Возвращает, сколько теперь у меня. */
create or replace function public.staff_claim(p_n int default 5) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mine int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update submissions s set claimed_by = uid, claimed_at = now()
  where s.id in (
    select id from submissions x
    where x.status = 'pending' and not (x.claimed_by is not null and x.claimed_at > now() - make_interval(mins => _claim_minutes()))
    order by x.created_at limit greatest(1, least(20, coalesce(p_n, 5)))
    for update skip locked);
  -- продлеваем свои, чтобы не утекли, пока проверяю
  update submissions set claimed_at = now() where status = 'pending' and claimed_by = uid;
  select count(*) into mine from submissions where status = 'pending' and claimed_by = uid;
  return mine;
end $$;

/** Вернуть свои непроверенные сдачи в общую очередь. */
create or replace function public.staff_release() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update submissions set claimed_by = null, claimed_at = null where status = 'pending' and claimed_by = auth.uid();
end $$;

create or replace function public.staff_submissions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'player', p.username, 'playerId', p.id, 'faction', p.faction, 'task', s.task,
    'text', s.text, 'photo', s.photo, 'at', ms(s.created_at), 'status', s.status, 'rating', s.rating, 'note', s.note,
    'claimedBy', case when _claim_live(s) then (select username from players where id = s.claimed_by) end,
    'claimedMine', _claim_live(s) and s.claimed_by = auth.uid()) order by s.created_at)
    from submissions s join players p on p.id = s.player_id where s.status = 'pending'), '[]'::jsonb);
end $$;

/** Проверка: чужую взятую сдачу не трогаем, пока она закреплена за другим. */
create or replace function public.staff_review(p_id bigint, p_ok boolean, p_rating int, p_note text default null, p_title text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s submissions; g int := 0; title text; msg text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into s from submissions where id = p_id and status = 'pending' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Уже проверено'); end if;
  if _claim_live(s) and s.claimed_by <> auth.uid() then
    raise exception 'Эту сдачу проверяет %', (select username from players where id = s.claimed_by);
  end if;
  title := coalesce(nullif(btrim(p_title), ''), s.task);
  if p_ok then g := _grant_task(s.player_id, s.task, greatest(0, least(coalesce(p_rating, 0), 500)), 'staff', auth.uid()); end if;
  update submissions set status = case when p_ok then 'approved' else 'rejected' end, rating = g, note = left(nullif(btrim(p_note), ''), 300),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  msg := case when p_ok then '✅ Принято: «' || title || '» — +' || g || ' баллов' || coalesce('. ' || nullif(btrim(p_note), ''), '')
              else '❌ Не принято: «' || title || '»' || coalesce(' — ' || nullif(btrim(p_note), ''), '') || '. Можно сдать заново.' end;
  perform _notify(s.player_id, msg, case when p_ok then 'ok' else 'bad' end, p_id);
  return jsonb_build_object('ok', true, 'granted', g);
end $$;

-- ---------- Зоны дежурства ----------
create table if not exists public.staff_duty (
  player_id uuid primary key references public.players(id) on delete cascade,
  zone text not null default 'free' check (zone in ('mod', 'qr', 'merch', 'live', 'map', 'help', 'free')),
  note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.staff_duty enable row level security;

create or replace function public.staff_set_duty(p_zone text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_zone not in ('mod', 'qr', 'merch', 'live', 'map', 'help', 'free') then raise exception 'unknown zone'; end if;
  insert into staff_duty (player_id, zone, note, updated_at) values (auth.uid(), p_zone, left(btrim(coalesce(p_note, '')), 60), now())
  on conflict (player_id) do update set zone = excluded.zone, note = excluded.note, updated_at = now();
end $$;

/** Команда: кто из состава в игре, на какой зоне, сколько проверил сегодня и сколько держит в работе. */
create or replace function public.staff_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.username, 'role', p.role, 'me', p.id = auth.uid(),
      'zone', coalesce(d.zone, 'free'), 'note', coalesce(d.note, ''), 'at', ms(coalesce(d.updated_at, p.updated_at)),
      'reviewed', (select count(*) from submissions s where s.reviewed_by = p.id and s.reviewed_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'),
      'holding', (select count(*) from submissions s where s.status = 'pending' and s.claimed_by = p.id and s.claimed_at > now() - make_interval(mins => _claim_minutes())),
      'qrOpen', (select count(*) from lectures l where l.opened_by = p.id and l.closes_at > now()))
    order by case coalesce(d.zone, 'free') when 'free' then 1 else 0 end, p.username)
    from players p left join staff_duty d on d.player_id = p.id
    where p.roster_id is not null and p.role in ('staff', 'admin')), '[]'::jsonb);
end $$;

-- ---------- QR-отметки: одна и та же не открывается дважды ----------
create or replace function public.lecture_json(l public.lectures, with_secret boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'title', l.title, 'points', l.points, 'openedAt', ms(l.opened_at), 'closesAt', ms(l.closes_at),
    'kind', l.kind, 'maxClaims', l.max_claims, 'rotating', l.rotating,
    'claims', (select count(*) from lecture_claims c where c.lecture_id = l.id),
    'mine', exists (select 1 from lecture_claims c where c.lecture_id = l.id and c.player_id = auth.uid()))
    || case when with_secret then jsonb_strip_nulls(jsonb_build_object('secret', l.secret, 'code', l.static_code,
         'openedByName', (select username from players where id = l.opened_by))) else '{}'::jsonb end
$$;

create or replace function public.staff_lecture_open(p_title text, p_points int, p_minutes int, p_kind text default 'lecture', p_max int default 0, p_rotating boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l lectures; k text := case when p_kind in ('lecture', 'speed', 'activity') then p_kind else 'lecture' end; rot boolean := coalesce(p_rotating, true);
  v_code text; i int := 0; v_title text := left(coalesce(nullif(btrim(p_title), ''), 'Блок'), 80);
begin
  if not is_staff() then raise exception 'staff only'; end if;
  -- уже открыта такая же — показываем её, а не плодим вторую (иначе можно отметиться дважды)
  select * into l from lectures where lower(title) = lower(v_title) and kind = k and closes_at > now() order by opened_at desc limit 1;
  if found then return lecture_json(l, true) || jsonb_build_object('existing', true); end if;
  if not rot then
    loop
      v_code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
      exit when not exists (select 1 from lectures where static_code = v_code);
      i := i + 1; if i > 20 then raise exception 'Не получилось придумать код'; end if;
    end loop;
  end if;
  insert into lectures (id, title, points, secret, closes_at, opened_by, kind, max_claims, rotating, static_code)
  values (substr(md5(random()::text), 1, 10), v_title, least(50, greatest(1, coalesce(p_points, 15))),
    encode(extensions.gen_random_bytes(16), 'hex'), now() + make_interval(mins => least(case when rot then 180 else 1440 end, greatest(1, coalesce(p_minutes, 7)))), auth.uid(),
    k, least(500, greatest(0, coalesce(p_max, 0))), rot, v_code)
  returning * into l;
  return lecture_json(l, true);
end $$;

revoke execute on function public.staff_claim(int), public.staff_release(), public.staff_set_duty(text, text), public.staff_team() from public, anon;
grant execute on function public.staff_claim(int), public.staff_release(), public.staff_set_duty(text, text), public.staff_team() to authenticated;

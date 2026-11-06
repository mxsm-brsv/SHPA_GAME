-- Вечерка (v9 кнопки): отдельный бот + «Приз зрительских симпатий».
-- 1. Вечерка — только для участников выезда. Каждый входит по ФИО и группе из списка выезда (как в игре ШПА,
--    но отдельно от неё): профбюро берётся из списка (roster.faction). Одна строка списка — один телефон;
--    сбросить вход может ведущий. Оргкомитет входит по ФИО и коду организатора: кнопку не жмёт,
--    голосовать может за любой клип.
-- 2. Кнопку за команду жмёт один человек из этой команды (bz_teams.captain) — выбирают сами или ведущий.
-- 3. Голосование за клипы: один голос на человека из списка, за клип своего профбюро нельзя, передумать можно,
--    пока голосование открыто.
-- В Supabase запросы из приложения идут через safeupdate: UPDATE/DELETE по всей таблице — только с явным «where true».

alter table public.bz_teams add column if not exists code text;
alter table public.bz_clients add column if not exists roster_id bigint unique references public.roster(id) on delete set null;
alter table public.bz_clients add column if not exists fio text;
alter table public.bz_clients add column if not exists grp text;
alter table public.bz_clients add column if not exists team_id int references public.bz_teams(id) on delete set null;
alter table public.bz_clients add column if not exists team_src text check (team_src in ('roster', 'host'));
alter table public.bz_clients add column if not exists team_at timestamptz;
create index if not exists bz_clients_team on public.bz_clients (team_id);

alter table public.bz_game add column if not exists vote_status text not null default 'off' check (vote_status in ('off', 'open', 'closed', 'shown'));
alter table public.bz_game add column if not exists vote_title text not null default 'Лучший клип';

create table if not exists public.bz_clips (
  id serial primary key,
  num int not null,
  title text not null default '',
  team_id int references public.bz_teams(id) on delete set null,   -- чей клип (за свой голосовать нельзя)
  active boolean not null default true
);
create table if not exists public.bz_votes (
  client_id bigint primary key references public.bz_clients(id) on delete cascade,
  clip_id int not null references public.bz_clips(id) on delete cascade,
  team_id int,                       -- профбюро голосующего в момент голоса
  src text,                          -- roster | host — откуда это профбюро
  kind text,                         -- tg | web
  at timestamptz not null default now()
);
create index if not exists bz_votes_clip on public.bz_votes (clip_id);
alter table public.bz_clips enable row level security;
alter table public.bz_votes enable row level security;

/** Код профбюро из названия команды (как в списке выезда): «ПБ ИРЭ» → ire. */
create or replace function public._bz_code(p_name text) returns text language sql immutable as $$
  select case
    when n like '% ГПИ %' then 'gpi' when n like '% ИВТИ %' then 'ivti' when n like '% ИГВИЭ %' then 'igvie'
    when n like '% ИНЭИ %' then 'inei' when n like '% ИРЭ %' then 'ire' when n like '% ИТАЭ %' then 'itae'
    when n like '% ИЭВТ %' then 'ievt' when n like '% ИЭТЭ %' then 'iete' when n like '% ИЭЭ %' then 'iee'
    when n like '% ЭНМИ %' then 'enmi' end
  from (select ' ' || regexp_replace(replace(upper(coalesce(p_name, '')), 'Ё', 'Е'), '[^А-ЯA-Z0-9]+', ' ', 'g') || ' ' as n) x
$$;
update public.bz_teams set code = _bz_code(name) where code is distinct from _bz_code(name);

-- по клипу от каждого профбюро — ведущий может переименовать и добавить
insert into public.bz_clips (num, team_id)
select tm.num, tm.id from public.bz_teams tm where tm.active and not exists (select 1 from public.bz_clips) order by tm.num;

-- ───────────────────────── вход ─────────────────────────

/** Повторный вход из Telegram не затирает имя из списка выезда. */
create or replace function public._bz_issue(p_ident text, p_kind text, p_name text, p_username text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); cid bigint; nm2 text;
  nm text := left(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), 40);
begin
  if nm is null then nm := 'Без имени'; end if;
  insert into bz_clients (ident, kind, token_hash, name, username)
  values (p_ident, p_kind, _bz_hash(tok), nm, left(nullif(btrim(coalesce(p_username, '')), ''), 40))
  on conflict (ident) do update set token_hash = excluded.token_hash,
    name = case when bz_clients.roster_id is null then excluded.name else bz_clients.name end,
    username = excluded.username, as_of_ms = null, last_seen_ms = null
  returning id, name into cid, nm2;
  return jsonb_build_object('ok', true, 'token', tok, 'id', cid, 'name', nm2);
end $$;

/** Команда для профбюро из списка выезда (оргкомитет и профбюро, которого нет среди команд, — без команды). */
create or replace function public._bz_team_for(p_faction text) returns int language sql stable security definer set search_path = public as $$
  select id from bz_teams where active and code = p_faction order by num limit 1
$$;

/**
 * Вход по ФИО и группе из списка выезда (сверка — та же, что в игре ШПА: порядок слов любой, опечатка
 * в длинных словах прощается, цифры группы должны совпасть). p_code — код организатора для оргкомитета.
 * 8 ошибок за 15 минут — пауза.
 */
create or replace function public.bz_login(p_token text, p_fio text, p_group text, p_code text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  c bz_clients := _bz_client(p_token); r roster; n int; k text; other bz_clients; tid int; parts text[];
  staff boolean := coalesce(btrim(p_code), '') <> ''; ids bigint[]; ids3 bigint[];
  words text[] := string_to_array(norm_fio(p_fio), ' ');
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  k := 'bzl:' || c.id;
  delete from bz_attempts where at < now() - interval '15 minutes';
  if (select count(*) from bz_attempts where key = k) >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много попыток. Подожди 15 минут или подойди к ведущему.');
  end if;
  if length(btrim(coalesce(p_fio, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'Напиши фамилию и имя'); end if;
  if staff and (setting_text('staff_code', '') = '' or _bz_norm_code(p_code) <> _bz_norm_code(setting_text('staff_code', ''))) then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', 'Неверный код организатора');
  end if;
  if not staff and coalesce(btrim(p_group), '') = '' and setting_bool('require_group', true) then
    return jsonb_build_object('ok', false, 'error', 'Напиши группу — как в списке выезда, например ЭР-01-24');
  end if;

  select array_agg(f.id) into ids from roster_find(p_fio, p_group, staff) f;
  n := coalesce(array_length(ids, 1), 0);
  -- тёзки (фамилия и имя совпали): различаем по отчеству, если его написали
  if n > 1 and coalesce(array_length(words, 1), 0) >= 3 then
    select array_agg(ro.id) into ids3 from roster ro
    where ro.id = any(ids) and split_part(ro.fio_norm, ' ', 3) <> ''
      and exists(select 1 from unnest(words) w
                 where levenshtein(w, split_part(ro.fio_norm, ' ', 3)) <= roster_tol(split_part(ro.fio_norm, ' ', 3)));
    if coalesce(array_length(ids3, 1), 0) >= 1 then ids := ids3; n := array_length(ids3, 1); end if;
  end if;
  if n = 0 then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', case when staff then 'Не нашли тебя в составе оргкомитета. Проверь фамилию и имя.'
      else 'Не нашли тебя в списке выезда. Проверь ФИО и группу. Если всё верно — подойди к ведущему.' end);
  end if;
  if n > 1 then return jsonb_build_object('ok', false, 'error', 'Нашли несколько похожих — напиши ФИО полностью, с отчеством.'); end if;
  select * into r from roster where id = ids[1];

  perform 1 from bz_game where id = 1 for update;
  select * into c from bz_clients where id = c.id for update;
  if c.roster_id is not distinct from r.id then
    return jsonb_build_object('ok', true) || _bz_view(false, c.id);
  end if;
  select * into other from bz_clients where roster_id = r.id;
  if other.id is not null then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', 'Под этим ФИО уже вошли с другого телефона. Если это не ты — подойди к ведущему, он сбросит вход.');
  end if;
  if c.roster_id is not null and exists(select 1 from bz_votes where client_id = c.id) then
    return jsonb_build_object('ok', false, 'error', 'Ты уже проголосовал(а) — сменить вход может только ведущий.');
  end if;

  tid := _bz_team_for(r.faction);
  parts := string_to_array(r.fio, ' ');
  update bz_clients set roster_id = r.id, fio = r.fio, grp = nullif(r.grp, ''),
    name = left(coalesce(parts[2] || ' ', '') || parts[1], 40),
    team_id = tid, team_src = 'roster', team_at = now()
  where id = c.id;
  -- жал кнопку за другую команду — кнопка освобождается
  update bz_teams set captain = null, claimed_at = null where captain = c.id and id is distinct from tid;
  delete from bz_votes bv using bz_clips kk where bv.client_id = c.id and kk.id = bv.clip_id and kk.team_id = tid;
  perform _bz_bump();
  return jsonb_build_object('ok', true) || _bz_view(false, c.id);
end $$;

/** «Это не я» — выйти из ФИО, пока не проголосовал. */
create or replace function public.bz_logout(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token);
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  perform 1 from bz_game where id = 1 for update;
  if exists(select 1 from bz_votes where client_id = c.id) then
    return jsonb_build_object('ok', false, 'error', 'Ты уже проголосовал(а) — сменить вход может только ведущий.');
  end if;
  update bz_teams set captain = null, claimed_at = null where captain = c.id;
  update bz_clients set roster_id = null, fio = null, grp = null, team_id = null, team_src = null, team_at = now() where id = c.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true) || _bz_view(false, c.id);
end $$;

-- ───────────────────────── состояние ─────────────────────────

create or replace function public._bz_view(p_host boolean, p_client bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms();
  g bz_game; r bz_rounds; st text; cl_ms double precision; cl_by text; my bz_clients;
  teams jsonb; rj jsonb := null; me jsonb := null; hist jsonb := null; clips jsonb; vote jsonb; members jsonb := null;
  w double precision; blockers int; waiting jsonb; offline jsonb; presses jsonb; settled boolean;
  off_ms constant double precision := 3500;
begin
  select * into g from bz_game where id = 1;
  if p_client is not null then select * into my from bz_clients where id = p_client; end if;

  select coalesce(jsonb_agg(x.j order by x.num), '[]'::jsonb) into teams from (
    select tm.num, jsonb_build_object(
        'id', tm.id, 'num', tm.num, 'name', tm.name,
        'score', coalesce((select sum(p.points) from bz_presses p join bz_rounds rr on rr.id = p.round_id
                            where p.team_id = tm.id and rr.status <> 'void'), 0)
               + coalesce((select sum(a.delta) from bz_adjust a where a.team_id = tm.id), 0),
        'claimed', tm.captain is not null,
        'online', c.last_seen_ms is not null and t - c.last_seen_ms < off_ms,
        'mine', coalesce(my.team_id = tm.id, false),
        'members', (select count(*) from bz_clients m where m.team_id = tm.id)
      ) || case when my.team_id = tm.id and c.id is not null then jsonb_build_object('captain_name', c.name, 'captain_me', c.id = my.id)
        else '{}'::jsonb end
        || case when p_host and c.id is not null then jsonb_build_object(
        'captain', jsonb_build_object('id', c.id, 'name', c.name, 'username', c.username, 'kind', c.kind, 'fio', c.fio),
        'ago_ms', round((t - c.last_seen_ms)::numeric),
        'rtt', round(c.rtt_ms::numeric), 'err', round(c.err_ms::numeric, 1),
        'seen_lag', case when c.seen_round = g.round_id then round(c.seen_lag_ms::numeric) end,
        'app', c.app)
      else '{}'::jsonb end as j
    from bz_teams tm left join bz_clients c on c.id = tm.captain
    where tm.active
  ) x;

  if g.round_id is not null then
    select * into r from bz_rounds where id = g.round_id;
  end if;

  if r.id is not null then
    st := r.status; cl_ms := r.closed_ms; cl_by := r.closed_by;
    if st = 'open' and r.closes_ms is not null and t >= r.closes_ms then st := 'closed'; cl_ms := r.closes_ms; cl_by := 'limit'; end if;
    if st = 'open' and t < r.opens_ms then st := 'countdown'; end if;

    select min(coalesce(c.as_of_ms, 0)), count(*) into w, blockers
    from bz_teams tm join bz_clients c on c.id = tm.captain
    where tm.active and c.last_seen_ms is not null and t - c.last_seen_ms < off_ms
      and not exists (select 1 from bz_presses p where p.round_id = r.id and p.team_id = tm.id);

    select coalesce(jsonb_agg(tm.id order by tm.num), '[]'::jsonb) into waiting
    from bz_teams tm join bz_clients c on c.id = tm.captain
    where tm.active and c.last_seen_ms is not null and t - c.last_seen_ms < off_ms
      and not exists (select 1 from bz_presses p where p.round_id = r.id and p.team_id = tm.id);
    select coalesce(jsonb_agg(tm.id order by tm.num), '[]'::jsonb) into offline
    from bz_teams tm left join bz_clients c on c.id = tm.captain
    where tm.active and tm.captain is not null and (c.last_seen_ms is null or t - c.last_seen_ms >= off_ms)
      and not exists (select 1 from bz_presses p where p.round_id = r.id and p.team_id = tm.id);

    select coalesce(jsonb_agg(y.j order by y.place), '[]'::jsonb), coalesce(bool_and((y.j->>'confirmed')::boolean), true)
    into presses, settled from (
      select q.place, jsonb_build_object(
          'team', q.team_id, 'place', q.place,
          'press_ms', q.press_ms, 'rel_ms', round((q.press_ms - r.opens_ms)::numeric, 1),
          'gap_ms', round(q.gap::numeric, 1), 'tie', q.gap is not null and q.gap < 30,
          'unsure', q.gap is not null and q.gap < coalesce(q.err_ms, 0) + coalesce(q.prev_err, 0),
          'confirmed', blockers = 0 or w >= least(q.press_ms + 30, coalesce(cl_ms, 'infinity'::double precision)),
          'verdict', q.verdict, 'points', q.points
        ) || case when p_host then jsonb_build_object(
          'delivery_ms', round((q.arrival_ms - q.press_ms)::numeric), 'rtt', round(q.rtt_ms::numeric),
          'err', round(q.err_ms::numeric, 1), 'attempts', q.attempts, 'flags', to_jsonb(q.flags))
        else '{}'::jsonb end as j
      from (
        select p.*, row_number() over (order by p.press_ms, p.arrival_ms) as place,
               p.press_ms - lag(p.press_ms) over (order by p.press_ms, p.arrival_ms) as gap,
               lag(p.err_ms) over (order by p.press_ms, p.arrival_ms) as prev_err
        from bz_presses p join bz_teams tm on tm.id = p.team_id
        where p.round_id = r.id and tm.active
      ) q
    ) y;

    settled := settled and (st = 'closed' or st = 'void' or blockers = 0);
    rj := jsonb_build_object('id', r.id, 'n', r.n, 'status', st, 'opens_ms', r.opens_ms, 'closes_ms', r.closes_ms,
      'closed_ms', cl_ms, 'closed_by', cl_by, 'presses', presses, 'waiting', waiting, 'offline', offline,
      'settled', settled, 'watermark', case when p_host then w end);
  end if;

  -- клипы и голосование: счёт виден ведущему всегда, остальным — когда ведущий показал итоги
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'num', k.num, 'title', k.title, 'team', k.team_id)
      || case when p_host or g.vote_status = 'shown' then jsonb_build_object('votes', (select count(*) from bz_votes v where v.clip_id = k.id))
         else '{}'::jsonb end
      order by k.num), '[]'::jsonb) into clips
  from bz_clips k where k.active;
  vote := jsonb_build_object('status', g.vote_status, 'title', g.vote_title,
    'total', (select count(*) from bz_votes v join bz_clips k on k.id = v.clip_id and k.active));

  if my.id is not null then
    me := jsonb_build_object('id', my.id, 'name', my.name, 'fio', my.fio, 'grp', my.grp, 'kind', my.kind,
      'in', my.roster_id is not null,
      'org', coalesce((select ro.faction = 'profkom' from roster ro where ro.id = my.roster_id), false),
      -- кто ещё в моём профбюро — чтобы выбрать, кто жмёт кнопку
      'mates', case when my.team_id is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
                 'captain', exists(select 1 from bz_teams x where x.captain = m.id and x.active)) order by m.name), '[]'::jsonb)
        from bz_clients m where m.team_id = my.team_id) end,
      'team', my.team_id, 'team_src', my.team_src,
      'captain', exists(select 1 from bz_teams tm where tm.captain = my.id and tm.active),
      'vote', (select clip_id from bz_votes where client_id = my.id));
  end if;

  if p_host then
    select coalesce(jsonb_agg(h.j order by h.id desc), '[]'::jsonb) into hist from (
      select rr.id, jsonb_build_object('id', rr.id, 'n', rr.n, 'status', rr.status,
        'order', coalesce((select jsonb_agg(jsonb_build_object('team', p.team_id, 'verdict', p.verdict, 'points', p.points,
                    'rel_ms', round((p.press_ms - rr.opens_ms)::numeric)) order by p.press_ms, p.arrival_ms)
                  from bz_presses p where p.round_id = rr.id), '[]'::jsonb)) as j
      from bz_rounds rr where rr.id <> coalesce(g.round_id, -1) order by rr.id desc limit 30
    ) h;
    -- все, кто открыл кнопку: [id, имя, ФИО, команда, откуда команда, tg/web, на связи, проголосовал, группа]
    select coalesce(jsonb_agg(jsonb_build_array(m.id, m.name, m.fio, m.team_id, m.team_src, m.kind,
        m.last_seen_ms is not null and t - m.last_seen_ms < 10000,
        exists(select 1 from bz_votes v where v.client_id = m.id), m.grp) order by m.team_id nulls first, m.fio nulls first, m.name), '[]'::jsonb)
    into members from bz_clients m;
  end if;

  return jsonb_build_object('v', g.v, 'game', jsonb_build_object('title', g.title, 'locked', g.teams_locked,
      'countdown_ms', g.countdown_ms, 'limit_ms', g.limit_ms, 'lockout_ms', g.lockout_ms, 'pts_ok', g.pts_ok,
      'pts_bad', g.pts_bad, 'auto_close', g.auto_close, 'own_code', g.host_code_hash is not null),
    'teams', teams, 'round', rj, 'clips', clips, 'vote', vote)
    || case when me is not null then jsonb_build_object('me', me) else '{}'::jsonb end
    || case when p_host then jsonb_build_object('history', hist, 'members', members) else '{}'::jsonb end;
end $$;

-- ───────────────────────── пульс ─────────────────────────

create or replace function public.bz_tick(p_token text, p_v bigint default 0, p_asof double precision default null,
  p_rtt real default null, p_err real default null, p_round int default null, p_seen double precision default null,
  p_press jsonb default null, p_app text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t0 double precision := bz_ms(); c bz_clients := _bz_client(p_token); g bz_game; pr jsonb := null; live boolean;
  opens double precision; res jsonb; cap boolean;
begin
  if c.id is null then return jsonb_build_object('error', 'auth', 't0', t0, 't', bz_ms()); end if;
  if p_press is not null and jsonb_typeof(p_press) = 'object' then
    pr := _bz_press(c.id, (p_press->>'round')::int, (p_press->>'ms')::double precision,
                    (p_press->>'rtt')::real, (p_press->>'err')::real, coalesce((p_press->>'n')::int, 1));
  end if;
  select * into g from bz_game where id = 1;
  select opens_ms into opens from bz_rounds where id = g.round_id;
  update bz_clients set
    last_seen_ms = t0,
    as_of_ms = case when p_asof is null or p_asof <> p_asof then as_of_ms
                    else greatest(coalesce(as_of_ms, 0), least(p_asof, t0 + 100)) end,
    rtt_ms = coalesce(p_rtt, rtt_ms),
    err_ms = coalesce(p_err, err_ms),
    seen_lag_ms = case when p_round is not null and p_round = g.round_id and seen_round is distinct from p_round
                       then greatest(-60000, least(60000, coalesce(p_seen, t0) - opens)) else seen_lag_ms end,
    seen_round = case when p_round is not null and p_round = g.round_id then p_round else seen_round end,
    app = coalesce(left(p_app, 80), app)
  where id = c.id;

  -- состояние каждым пульсом нужно только тому, кто жмёт кнопку (места подтверждаются без смены версии);
  -- остальные получают его, когда что-то поменялось
  select exists(select 1 from bz_teams where captain = c.id and active) into cap;
  select cap and exists(select 1 from bz_rounds where id = g.round_id and status <> 'void'
                and ((status = 'open' and coalesce(closes_ms, 'infinity'::double precision) > t0 - 15000) or closed_ms > t0 - 15000)) into live;
  if p_v is distinct from g.v or live or pr is not null then
    res := _bz_view(false, c.id);
  else
    res := jsonb_build_object('v', g.v);
  end if;
  return res || jsonb_build_object('t0', t0, 't', bz_ms(), 'press', pr);
end $$;

-- ───────────────────────── кнопка ─────────────────────────

/** Ошибка, если человек не может жать за свою команду (null — может). */
create or replace function public._bz_need_team(c bz_clients) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if c.roster_id is null and c.team_id is null then return 'Сначала войди по ФИО и группе'; end if;
  if c.team_id is null then
    if exists(select 1 from roster where id = c.roster_id and faction = 'profkom') then
      return 'Оргкомитет не жмёт кнопку за команды';
    end if;
    return 'Твоего профбюро нет среди команд — подойди к ведущему';
  end if;
  return null;
end $$;

/** «Кнопку за команду жму я» — только за своё профбюро. */
create or replace function public.bz_claim(p_token text, p_team int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); tm bz_teams; g bz_game; cap bz_clients; e text; mine bz_teams;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;
  select * into c from bz_clients where id = c.id;
  select * into tm from bz_teams where id = p_team and active for update;
  if tm.id is null then return jsonb_build_object('ok', false, 'error', 'Такой команды нет'); end if;
  if tm.captain = c.id then return jsonb_build_object('ok', true); end if;
  e := _bz_need_team(c);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  if c.team_id <> tm.id then
    select * into mine from bz_teams where id = c.team_id;
    return jsonb_build_object('ok', false, 'error', format('Ты в профбюро «%s» — жать кнопку можно только за свою команду.', mine.name));
  end if;
  if g.teams_locked then return jsonb_build_object('ok', false, 'error', 'Ведущий закрыл выбор, кто жмёт кнопку. Подойди к ведущему.'); end if;
  if tm.captain is not null then
    select * into cap from bz_clients where id = tm.captain;
    return jsonb_build_object('ok', false, 'error', format('За команду «%s» уже жмёт %s. Если это ошибка — попроси ведущего освободить кнопку.', tm.name, cap.name));
  end if;
  update bz_teams set captain = null, claimed_at = null where captain = c.id;
  update bz_teams set captain = c.id, claimed_at = now() where id = tm.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true);
end $$;

/**
 * Выбрать, кто жмёт кнопку за команду: любой из профбюро, пока кнопка свободна, или тот, кто жмёт сейчас
 * (передаёт другому). Назначить можно только человека из своего профбюро.
 */
create or replace function public.bz_assign(p_token text, p_client bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); g bz_game; tm bz_teams; target bz_clients; cap bz_clients; e text;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;
  select * into c from bz_clients where id = c.id;
  e := _bz_need_team(c);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  select * into tm from bz_teams where id = c.team_id and active for update;
  if tm.id is null then return jsonb_build_object('ok', false, 'error', 'Твоей команды нет в игре'); end if;
  if g.teams_locked then return jsonb_build_object('ok', false, 'error', 'Ведущий закрыл выбор, кто жмёт кнопку. Подойди к ведущему.'); end if;
  if tm.captain is not null and tm.captain <> c.id then
    select * into cap from bz_clients where id = tm.captain;
    return jsonb_build_object('ok', false, 'error', format('Кнопку жмёт %s — передать её может только он или ведущий.', cap.name));
  end if;
  select * into target from bz_clients where id = p_client and team_id = tm.id;
  if target.id is null then return jsonb_build_object('ok', false, 'error', 'Этот человек не из твоего профбюро'); end if;
  update bz_teams set captain = target.id, claimed_at = now() where id = tm.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── голосование ─────────────────────────

/** Голос за клип (p_clip = null — забрать голос). Возвращает свежее состояние телефона. */
create or replace function public.bz_vote(p_token text, p_clip int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); g bz_game; k bz_clips; tname text;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;
  select * into c from bz_clients where id = c.id;
  if g.vote_status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Голосование сейчас закрыто'); end if;
  if c.roster_id is null then return jsonb_build_object('ok', false, 'error', 'Сначала войди по ФИО и группе — голосуют участники выезда'); end if;
  if p_clip is null then
    delete from bz_votes where client_id = c.id;
  else
    select * into k from bz_clips where id = p_clip and active;
    if k.id is null then return jsonb_build_object('ok', false, 'error', 'Такого клипа нет'); end if;
    if k.team_id is not null and k.team_id = c.team_id then
      select name into tname from bz_teams where id = k.team_id;
      return jsonb_build_object('ok', false, 'error', format('Это клип твоего профбюро («%s») — за него голосовать нельзя', tname));
    end if;
    insert into bz_votes (client_id, clip_id, team_id, src, kind) values (c.id, k.id, c.team_id, c.team_src, c.kind)
    on conflict (client_id) do update set clip_id = excluded.clip_id, team_id = excluded.team_id, src = excluded.src,
      kind = excluded.kind, at = now();
  end if;
  update bz_clients set last_seen_ms = bz_ms() where id = c.id;
  return jsonb_build_object('ok', true) || _bz_view(false, c.id);
end $$;

-- ───────────────────────── ведущий ─────────────────────────

create or replace function public.bz_host(p_host text, p_act text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms(); g bz_game; rid int; n int; tid int; cid bigint; vv text; names text[]; i int; nm text;
  cd int; code text; a jsonb := coalesce(p_arg, '{}'::jsonb); it jsonb;
begin
  if not _bz_host_ok(p_host) then return jsonb_build_object('error', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;

  if p_act = 'start' then
    update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'next'
      where id = g.round_id and status = 'open';
    select coalesce(max(x.n), 0) + 1 into n from bz_rounds x where x.status <> 'void';
    cd := greatest(0, least(10000, coalesce((a->>'countdown_ms')::int, g.countdown_ms)));
    insert into bz_rounds (n, created_ms, opens_ms, closes_ms)
    values (n, t, t + cd, case when g.limit_ms > 0 then t + cd + g.limit_ms end) returning id into rid;
    update bz_game set round_id = rid where id = 1;

  elsif p_act = 'stop' then
    update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'host'
      where id = g.round_id and status = 'open';

  elsif p_act = 'void' then
    update bz_rounds set status = 'void', closed_ms = coalesce(closed_ms, t), closed_by = coalesce(closed_by, 'void')
      where id = g.round_id;

  elsif p_act = 'verdict' then
    rid := coalesce((a->>'round')::int, g.round_id); tid := (a->>'team')::int; vv := a->>'v';
    if vv is not null and vv not in ('ok', 'bad') then return jsonb_build_object('error', 'bad verdict'); end if;
    update bz_presses set verdict = vv,
      points = case vv when 'ok' then g.pts_ok when 'bad' then -g.pts_bad else 0 end
      where round_id = rid and team_id = tid;
    if not found then return jsonb_build_object('error', 'Эта команда не нажимала'); end if;
    if vv = 'ok' then
      update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'ok'
        where id = rid and status = 'open';
    end if;

  elsif p_act = 'adjust' then
    tid := (a->>'team')::int;
    if not exists(select 1 from bz_teams where id = tid) then return jsonb_build_object('error', 'Нет команды'); end if;
    insert into bz_adjust (team_id, delta) values (tid, greatest(-100, least(100, coalesce((a->>'delta')::int, 0))));

  elsif p_act = 'teams' then
    select array_agg(left(btrim(x), 40) order by o) into names
    from jsonb_array_elements_text(coalesce(a->'names', '[]'::jsonb)) with ordinality e(x, o) where btrim(x) <> '';
    if coalesce(array_length(names, 1), 0) < 1 or array_length(names, 1) > 20 then
      return jsonb_build_object('error', 'Нужно от 1 до 20 команд');
    end if;
    for i in 1 .. array_length(names, 1) loop
      nm := names[i];
      update bz_teams set name = nm, active = true, code = _bz_code(nm) where num = i;
      if not found then insert into bz_teams (num, name, code) values (i, nm, _bz_code(nm)); end if;
    end loop;
    update bz_teams set active = false, captain = null, claimed_at = null where num > array_length(names, 1);
    -- вошедшие по списку выезда — в команду своего профбюро по новому списку
    update bz_clients c set team_id = _bz_team_for(r.faction) from roster r where c.team_src = 'roster' and r.id = c.roster_id;
    update bz_clients set team_id = null where team_id in (select id from bz_teams where not active);
    update bz_teams tm set captain = null, claimed_at = null
      where captain is not null and not exists(select 1 from bz_clients c where c.id = tm.captain and c.team_id = tm.id);

  elsif p_act = 'release' then
    update bz_teams set captain = null, claimed_at = null where id = (a->>'team')::int;
  elsif p_act = 'release_all' then
    update bz_teams set captain = null, claimed_at = null where captain is not null;
  elsif p_act = 'lock' then
    update bz_game set teams_locked = coalesce((a->>'on')::boolean, not teams_locked) where id = 1;

  elsif p_act = 'settings' then
    update bz_game set
      title = case when a ? 'title' and btrim(a->>'title') <> '' then left(btrim(a->>'title'), 60) else title end,
      countdown_ms = case when a ? 'countdown_ms' then greatest(0, least(10000, (a->>'countdown_ms')::int)) else countdown_ms end,
      limit_ms = case when a ? 'limit_ms' then greatest(0, least(600000, (a->>'limit_ms')::int)) else limit_ms end,
      lockout_ms = case when a ? 'lockout_ms' then greatest(0, least(5000, (a->>'lockout_ms')::int)) else lockout_ms end,
      pts_ok = case when a ? 'pts_ok' then greatest(0, least(100, (a->>'pts_ok')::int)) else pts_ok end,
      pts_bad = case when a ? 'pts_bad' then greatest(0, least(100, (a->>'pts_bad')::int)) else pts_bad end,
      auto_close = case when a ? 'auto_close' then (a->>'auto_close')::boolean else auto_close end,
      vote_title = case when a ? 'vote_title' and btrim(a->>'vote_title') <> '' then left(btrim(a->>'vote_title'), 60) else vote_title end
    where id = 1;

  elsif p_act = 'new_game' then
    update bz_game set round_id = null where id = 1;
    delete from bz_presses where true; delete from bz_rounds where true; delete from bz_adjust where true;

  elsif p_act = 'host_code' then
    code := _bz_norm_code(a->>'code');
    if code = '' then update bz_game set host_code_hash = null where id = 1;
    elsif length(code) < 4 then return jsonb_build_object('error', 'Код — минимум 4 символа');
    else update bz_game set host_code_hash = _bz_hash(code) where id = 1;
    end if;

  elsif p_act = 'logout_others' then
    delete from bz_hosts where token_hash <> _bz_hash(p_host);

  -- ── голосование ──
  elsif p_act = 'vote' then
    vv := a->>'status';
    if vv is null or vv not in ('off', 'open', 'closed', 'shown') then return jsonb_build_object('error', 'bad status'); end if;
    if vv = 'open' and not exists(select 1 from bz_clips where active) then return jsonb_build_object('error', 'Сначала добавьте клипы'); end if;
    update bz_game set vote_status = vv where id = 1;

  elsif p_act = 'vote_reset' then
    delete from bz_votes where true;
    update bz_game set vote_status = 'off' where id = 1;

  elsif p_act = 'clips' then
    -- [{team, title}] по порядку; менять список можно, пока нет голосов
    if exists(select 1 from bz_votes) then return jsonb_build_object('error', 'Уже есть голоса — сначала «Сбросить голоса»'); end if;
    if jsonb_typeof(a->'items') <> 'array' or jsonb_array_length(a->'items') < 1 or jsonb_array_length(a->'items') > 40 then
      return jsonb_build_object('error', 'Нужно от 1 до 40 клипов');
    end if;
    delete from bz_clips where true;
    i := 0;
    for it in select * from jsonb_array_elements(a->'items') loop
      i := i + 1;
      insert into bz_clips (num, title, team_id)
      values (i, left(btrim(coalesce(it->>'title', '')), 80),
              (select id from bz_teams where id = nullif(it->>'team', '')::int and active));
    end loop;

  elsif p_act = 'member' then
    -- ведущий переводит человека в другое профбюро (если в списке выезда ошибка); team = null — без профбюро
    cid := (a->>'client')::bigint; tid := nullif(a->>'team', '')::int;
    if not exists(select 1 from bz_clients where id = cid) then return jsonb_build_object('error', 'Нет такого человека'); end if;
    if tid is not null and not exists(select 1 from bz_teams where id = tid and active) then return jsonb_build_object('error', 'Нет такой команды'); end if;
    update bz_clients set team_id = tid, team_src = 'host', team_at = now() where id = cid;
    update bz_teams set captain = null, claimed_at = null where captain = cid and id is distinct from tid;
    -- голос за клип нового своего профбюро больше не считается
    delete from bz_votes bv using bz_clips k where bv.client_id = cid and k.id = bv.clip_id and k.team_id = tid;
    update bz_votes set team_id = tid, src = 'host' where client_id = cid;

  elsif p_act = 'captain' then
    -- ведущий назначает, кто жмёт кнопку за команду (человек переходит в это профбюро, если был в другом)
    tid := (a->>'team')::int; cid := (a->>'client')::bigint;
    if not exists(select 1 from bz_teams where id = tid and active) then return jsonb_build_object('error', 'Нет такой команды'); end if;
    if not exists(select 1 from bz_clients where id = cid) then return jsonb_build_object('error', 'Нет такого человека'); end if;
    update bz_teams set captain = null, claimed_at = null where captain = cid;
    update bz_clients set team_id = tid, team_src = 'host', team_at = now() where id = cid and team_id is distinct from tid;
    delete from bz_votes bv using bz_clips k where bv.client_id = cid and k.id = bv.clip_id and k.team_id = tid;
    update bz_teams set captain = cid, claimed_at = now() where id = tid;

  elsif p_act = 'unbind' then
    -- сбросить вход по ФИО: телефон снова попросит ФИО и группу, голос и кнопка снимаются
    cid := (a->>'client')::bigint;
    update bz_teams set captain = null, claimed_at = null where captain = cid;
    delete from bz_votes where client_id = cid;
    update bz_clients set roster_id = null, fio = null, grp = null, team_id = null, team_src = null, team_at = now() where id = cid;
    if not found then return jsonb_build_object('error', 'Нет такого человека'); end if;

  elsif p_act = 'kick' then
    -- убрать человека совсем (например, лишние входы из браузера): его голос и кнопка тоже снимаются
    cid := (a->>'client')::bigint;
    update bz_teams set captain = null, claimed_at = null where captain = cid;
    delete from bz_clients where id = cid;

  else
    return jsonb_build_object('error', 'Неизвестное действие');
  end if;

  perform _bz_bump();
  return _bz_view(true, null) || jsonb_build_object('t', bz_ms());
end $$;

revoke all on function public._bz_code(text), public._bz_team_for(text), public._bz_need_team(public.bz_clients),
  public._bz_issue(text, text, text, text), public._bz_view(boolean, bigint) from public, anon, authenticated;
grant execute on function public.bz_login(text, text, text, text), public.bz_logout(text),
  public.bz_vote(text, int), public.bz_claim(text, int), public.bz_assign(text, bigint),
  public.bz_tick(text, bigint, double precision, real, real, int, double precision, jsonb, text),
  public.bz_host(text, text, jsonb) to anon, authenticated;

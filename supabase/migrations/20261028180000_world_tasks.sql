-- Стычки, мероприятия, задания, модерация, коды. Правила те же, что в клиенте (src/core/world.ts, src/config/tasks.ts).
-- Раунды считаются «лениво»: любой вызов get_world() проводит наступившие раунды; pg_cron (если включён) — раз в минуту.

insert into public.settings (key, value) values
  ('test_mode', 'true'),
  ('round_minutes', '20')
on conflict (key) do nothing;

-- ---------- Мир ----------
create table if not exists public.world (
  id int primary key default 1 check (id = 1),
  round int not null default 1,
  next_at timestamptz not null default now()
);
insert into public.world (id) values (1) on conflict do nothing;

create table if not exists public.map_points (
  id text primary key,
  influence int not null,
  owner text,
  shield_round int not null default 0
);
insert into public.map_points (id, influence) values
  ('main', 14), ('admin', 10), ('bastille', 10), ('library', 10), ('dk', 12),
  ('steklyashka', 12), ('tec', 10), ('dorms', 14), ('stadium', 12), ('park', 10)
on conflict (id) do update set influence = excluded.influence;

create table if not exists public.faction_world (
  faction text primary key,
  influence int not null default 0,
  trophies text[] not null default '{}'
);
insert into public.faction_world (faction)
  select unnest(array['inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee'])
on conflict do nothing;

create table if not exists public.orders (
  player_id uuid not null references public.players(id) on delete cascade,
  round int not null,
  kind text check (kind in ('attack', 'defend')),
  point text references public.map_points(id),
  power int not null default 0,
  law real not null default 0,
  s int,
  won boolean,
  rating int,
  primary key (player_id, round)
);

create table if not exists public.cooldowns (
  player_id uuid not null references public.players(id) on delete cascade,
  round int not null,
  primary key (player_id, round)
);

create table if not exists public.rounds (
  round int primary key,
  at timestamptz not null default now(),
  results jsonb not null default '[]'::jsonb
);

create table if not exists public.round_schedule (at timestamptz primary key);
insert into public.round_schedule (at)
  select (d::date + h * interval '1 hour') at time zone 'Europe/Moscow'
  from (values ('2026-11-05'::date), ('2026-11-06'::date)) v(d), unnest(array[10, 14, 18, 22]) h
union all
  select ('2026-11-07'::date + h * interval '1 hour') at time zone 'Europe/Moscow' from unnest(array[10, 12, 14, 16, 18, 20, 22]) h
union all select timestamp '2026-11-08 10:00' at time zone 'Europe/Moscow'
union all select timestamp '2026-11-08 11:30' at time zone 'Europe/Moscow'
on conflict do nothing;

-- Мероприятия: порядок совпадает с MAP_EVENTS в клиенте
create table if not exists public.event_catalog (n int primary key, id text unique not null, trophy text not null);
insert into public.event_catalog (n, id, trophy) values
  (0, 'stipkom', 'Кодекс'), (1, 'sparta', 'Кубок'), (2, 'priem', 'Золотая печать'), (3, 'region', 'Вымпел'),
  (4, 'forum', 'Бейдж спикера'), (5, 'granty', 'Сундук'), (6, 'olymp', 'Лавровый венок')
on conflict (n) do update set id = excluded.id, trophy = excluded.trophy;

create table if not exists public.event_schedule (start_at timestamptz primary key, event_id text not null);
insert into public.event_schedule (start_at, event_id) values
  (timestamp '2026-11-05 13:00' at time zone 'Europe/Moscow', 'stipkom'), (timestamp '2026-11-05 19:00' at time zone 'Europe/Moscow', 'sparta'),
  (timestamp '2026-11-06 13:00' at time zone 'Europe/Moscow', 'priem'), (timestamp '2026-11-06 19:00' at time zone 'Europe/Moscow', 'granty'),
  (timestamp '2026-11-07 13:00' at time zone 'Europe/Moscow', 'forum'), (timestamp '2026-11-07 18:00' at time zone 'Europe/Moscow', 'region'),
  (timestamp '2026-11-08 09:00' at time zone 'Europe/Moscow', 'olymp')
on conflict do nothing;

create table if not exists public.events (
  key text primary key,
  event_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  closed boolean not null default false,
  places jsonb
);
create table if not exists public.event_scores (
  key text not null references public.events(key) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  score int not null,
  primary key (key, player_id)
);

-- ---------- Задания ----------
create table if not exists public.task_defs (id text primary key, amount int not null, lim text not null);
insert into public.task_defs (id, amount, lim) values
  ('profile', 20, 'once'), ('tg_channel', 20, 'once'), ('vk_group', 20, 'once'), ('intro_quiz', 5, 'once'),
  ('daily_login', 10, 'daily'), ('story', 30, 'once'), ('invite', 15, '3'), ('checkin', 30, 'once'),
  ('bingo', 40, '2'), ('grant', 50, 'once'), ('grant_best', 50, 'once'), ('speech', 40, 'once'),
  ('speech_best', 60, 'once'), ('duel', 30, '5'), ('team', 50, 'once'), ('brand', 30, 'once'),
  ('party_game', 30, '2'), ('party_contest', 30, '3'), ('sponsor', 50, 'once'), ('sponsor_best', 50, 'once'),
  ('reflection', 40, 'once'), ('press', 50, 'once'), ('thought', 20, '8'), ('egg', 15, '20'),
  ('egg_gold', 50, 'daily'), ('docs_quiz', 10, 'daily'), ('case_day', 20, 'daily'), ('meet', 5, 'daily'),
  ('caches', 15, '10'), ('cache_gold', 100, 'once'), ('help', 20, '3'), ('photo', 20, 'daily'), ('bonus', 0, '1000')
on conflict (id) do update set amount = excluded.amount, lim = excluded.lim;

create table if not exists public.submissions (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  task text not null,
  text text,
  photo text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rating int,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists submissions_status on public.submissions (status, created_at);

create table if not exists public.egg_codes (code text primary key, task text not null check (task in ('egg', 'egg_gold')), rating int not null, note text);
create table if not exists public.egg_redeems (player_id uuid references public.players(id) on delete cascade, code text references public.egg_codes(code) on delete cascade, at timestamptz default now(), primary key (player_id, code));
create table if not exists public.cache_codes (code text primary key, n int not null, gold boolean not null default false);
create table if not exists public.cache_finds (player_id uuid references public.players(id) on delete cascade, code text references public.cache_codes(code) on delete cascade, at timestamptz default now(), primary key (player_id, code));
create table if not exists public.meets (a uuid references public.players(id) on delete cascade, b uuid references public.players(id) on delete cascade, by_player uuid, day date not null default (now() at time zone 'Europe/Moscow')::date, primary key (a, b));
create table if not exists public.referrals (invitee uuid primary key references public.players(id) on delete cascade, inviter uuid not null references public.players(id) on delete cascade, at timestamptz default now());

-- Тестовые коды (как в демо). Перед выездом заменить на настоящие.
insert into public.egg_codes (code, task, rating, note) values ('ЭНЕРГИЯ', 'egg', 15, 'тест'), ('МОЛНИЯ', 'egg', 15, 'тест'), ('ЗОЛОТО', 'egg_gold', 50, 'тест') on conflict do nothing;
insert into public.cache_codes (code, n) select 'CACHE-' || lpad(i::text, 2, '0'), i from generate_series(1, 10) i on conflict do nothing;
insert into public.cache_codes (code, n, gold) values ('CACHE-GOLD', 0, true) on conflict do nothing;

alter table public.world enable row level security;
alter table public.map_points enable row level security;
alter table public.faction_world enable row level security;
alter table public.orders enable row level security;
alter table public.cooldowns enable row level security;
alter table public.rounds enable row level security;
alter table public.round_schedule enable row level security;
alter table public.event_catalog enable row level security;
alter table public.event_schedule enable row level security;
alter table public.events enable row level security;
alter table public.event_scores enable row level security;
alter table public.task_defs enable row level security;
alter table public.submissions enable row level security;
alter table public.egg_codes enable row level security;
alter table public.egg_redeems enable row level security;
alter table public.cache_codes enable row level security;
alter table public.cache_finds enable row level security;
alter table public.meets enable row level security;
alter table public.referrals enable row level security;

-- ---------- Фото к заданиям ----------
insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false) on conflict (id) do nothing;
drop policy if exists proofs_insert_own on storage.objects;
create policy proofs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists proofs_read on storage.objects;
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = auth.uid()::text or exists (select 1 from public.players where id = auth.uid() and is_staff)));

-- ---------- Вспомогательные ----------
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_staff from players where id = auth.uid()), false)
$$;

create or replace function public.ms(t timestamptz) returns bigint language sql immutable as $$
  select (extract(epoch from t) * 1000)::bigint
$$;

create or replace function public.player_code(p uuid) returns text language sql immutable as $$
  select 'PB-' || upper(substr(replace(p::text, '-', ''), 1, 8))
$$;

create or replace function public.test_mode() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'test_mode'), false)
$$;

create or replace function public.next_round_time(t timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare m int := setting_int('round_minutes', 20);
begin
  if test_mode() then
    return to_timestamp((floor(extract(epoch from t) / (m * 60)) + 1) * (m * 60));
  end if;
  return coalesce((select min(at) from round_schedule where at > t), t + interval '100 years');
end $$;

/** Сила удара: S = A × (1 + 0,05·R) × (1 + B) × (1 + 0,2·Q), бонусы ПБ — как в src/config/factions.ts */
create or replace function public.strike_power(fac text, kind text, power int, stage int, law real) returns numeric
language sql immutable as $$
  select power * (1 + 0.05 * least(10, 1 + floor((greatest(stage, 1) - 1) / 5)))
    * (1 + case when kind = 'attack' then case fac when 'ire' then 0.10 when 'enmi' then 0.06 else 0 end
                else case fac when 'iete' then 0.10 when 'iee' then 0.15 else 0 end end)
    * (1 + 0.2 * least(1, greatest(0, law)))
$$;

/** Рейтинг от игры с лимитами (30 с источника, 100 в сутки) — для любого игрока. */
create or replace function public._grant_game(uid uuid, p_source text, p_value int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d date := msk_day();
  cap_src int := setting_int('minigame_cap', 30);
  cap_total int := setting_int('game_rating_cap', 100);
  have_src int; have_total int; wanted int; g int; r int;
begin
  if is_frozen() then
    select rating into r from players where id = uid;
    return jsonb_build_object('granted', 0, 'rating', r, 'frozen', true);
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select coalesce(sum(amount), 0) into have_src from rating_log where player_id = uid and day = d and kind = 'game' and source = p_source;
  select coalesce(sum(amount), 0) into have_total from rating_log where player_id = uid and day = d and kind = 'game';
  wanted := greatest(0, least(cap_src, coalesce(p_value, 0)) - have_src);
  g := greatest(0, least(wanted, cap_total - have_total));
  if g > 0 then
    insert into rating_log (player_id, kind, source, amount) values (uid, 'game', p_source, g);
    update players set rating = rating + g, updated_at = now() where id = uid returning rating into r;
  else
    select rating into r from players where id = uid;
  end if;
  return jsonb_build_object('granted', g, 'rating', r);
end $$;

create or replace function public.add_game_rating(p_source text, p_value int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_source not in ('fever','ring','campaign','runner','stamp','wordle','bus','blocks','merge','crossword','categories','skirmish') then
    raise exception 'unknown source';
  end if;
  return _grant_game(auth.uid(), p_source, p_value);
end $$;

/** Рейтинг за задание с учётом лимита задания (вне игрового лимита). */
create or replace function public._grant_task(uid uuid, p_task text, p_amount int, p_kind text default 'task', p_by uuid default null, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  t task_defs; n int; mx int; r int;
begin
  select * into t from task_defs where id = p_task;
  if not found then raise exception 'unknown task %', p_task; end if;
  if is_frozen() and p_kind <> 'staff' then return 0; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text || p_task));
  select count(*) into n from rating_log where player_id = uid and source = p_task and kind in ('task', 'staff')
    and (t.lim <> 'daily' or day = msk_day());
  mx := case when t.lim in ('once', 'daily') then 1 else t.lim::int end;
  if p_task = 'meet' then mx := 20; end if;
  if n >= mx then return 0; end if;
  insert into rating_log (player_id, kind, source, amount, note, created_by) values (uid, p_kind, p_task, p_amount, p_note, p_by);
  update players set rating = rating + p_amount, updated_at = now() where id = uid returning rating into r;
  return p_amount;
end $$;

-- ---------- Стычки ----------
create or replace function public.resolve_round() returns void
language plpgsql security definer set search_path = public as $$
declare
  r int; p map_points; att_f text; att_s numeric; def_s numeric; prob numeric; win boolean;
  owners_n int; results jsonb := '[]'::jsonb; o record; v_won boolean; got jsonb;
begin
  select round into r from world where id = 1 for update;
  for p in select * from map_points order by id loop
    if p.shield_round >= r then continue; end if;
    select pl.faction, sum(strike_power(pl.faction, 'attack', o2.power, pl.stage, o2.law)) into att_f, att_s
      from orders o2 join players pl on pl.id = o2.player_id
      where o2.round = r and o2.kind = 'attack' and o2.point = p.id and pl.faction is distinct from p.owner
        and not exists (select 1 from cooldowns c where c.player_id = o2.player_id and c.round = r)
      group by pl.faction order by 2 desc limit 1;
    if att_f is null then continue; end if;
    select coalesce(sum(strike_power(pl.faction, 'defend', o2.power, pl.stage, o2.law)), 0) into def_s
      from orders o2 join players pl on pl.id = o2.player_id
      where o2.round = r and o2.kind = 'defend' and o2.point = p.id and pl.faction = p.owner
        and not exists (select 1 from cooldowns c where c.player_id = o2.player_id and c.round = r);
    def_s := def_s + case when p.owner is null then 380 * (1 + r * 0.08) else 250 end;
    if p.owner is not null then
      select count(*) into owners_n from players where faction = p.owner and not is_staff;
      if owners_n < 5 then def_s := def_s * 1.3; end if; -- защита малочисленных ПБ
    end if;
    prob := att_s / (att_s + def_s);
    win := random() < prob;
    results := results || jsonb_build_object('point', p.id, 'attacker', att_f, 'defender', p.owner, 'sAtt', round(att_s), 'sDef', round(def_s),
      'p', round(prob, 3), 'winner', case when win then att_f else p.owner end, 'changed', win);
    if win then update map_points set owner = att_f, shield_round = r + 1 where id = p.id; end if;
  end loop;
  update faction_world fw set influence = fw.influence + coalesce((select sum(mp.influence) from map_points mp where mp.owner = fw.faction), 0);
  -- итоги приказов
  for o in select o2.*, pl.faction, pl.stage from orders o2 join players pl on pl.id = o2.player_id where o2.round = r and o2.kind is not null loop
    if exists (select 1 from cooldowns c where c.player_id = o.player_id and c.round = r) then continue; end if;
    v_won := case when o.kind = 'attack' then exists (select 1 from jsonb_array_elements(results) x where x->>'point' = o.point and (x->>'changed')::boolean and x->>'winner' = o.faction)
                else (select owner from map_points where id = o.point) = o.faction end;
    got := case when v_won then _grant_game(o.player_id, 'skirmish', coalesce((select sum(amount) from rating_log where player_id = o.player_id and day = msk_day() and source = 'skirmish'), 0)::int + 10) else null end;
    update orders set won = v_won, rating = coalesce((got->>'granted')::int, 0), s = round(strike_power(o.faction, o.kind, o.power, o.stage, o.law))
      where player_id = o.player_id and round = r;
  end loop;
  insert into rounds (round, results) values (r, results) on conflict (round) do update set results = excluded.results, at = now();
  update world set round = r + 1, next_at = next_round_time(greatest(now(), next_at)) where id = 1;
end $$;

create or replace function public.current_event_slot(out event_id text, out start_at timestamptz, out end_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare h bigint;
begin
  if test_mode() then
    h := floor(extract(epoch from now()) / 3600);
    select c.id into event_id from event_catalog c where c.n = h % 7;
    start_at := to_timestamp(h * 3600);
    end_at := start_at + interval '60 minutes';
  else
    select s.event_id, s.start_at, s.start_at + interval '60 minutes' into event_id, start_at, end_at
      from event_schedule s where now() >= s.start_at and now() < s.start_at + interval '60 minutes' limit 1;
  end if;
end $$;

create or replace function public.resolve_due() returns void
language plpgsql security definer set search_path = public as $$
declare e events; v_places jsonb; slot record; guard int := 0;
begin
  if not pg_try_advisory_xact_lock(424242) then return; end if;
  while guard < 12 and (select next_at <= now() from world where id = 1) loop
    perform resolve_round();
    guard := guard + 1;
  end loop;
  for e in select * from events where not closed and end_at <= now() loop
    with ranked as (
      select pl.faction, es.score, row_number() over (partition by pl.faction order by es.score desc) rn
      from event_scores es join players pl on pl.id = es.player_id where es.key = e.key and pl.faction is not null
    ), tot as (select faction, sum(score) total from ranked where rn <= 5 group by faction)
    select coalesce(jsonb_agg(jsonb_build_object('faction', faction, 'total', total) order by total desc), '[]'::jsonb) into v_places from tot;
    update faction_world fw set influence = fw.influence + b.bonus
      from (select x->>'faction' f, (array[30, 20, 10])[row_number() over ()] bonus from jsonb_array_elements(v_places) x limit 3) b
      where fw.faction = b.f;
    if jsonb_array_length(v_places) > 0 then
      update faction_world set trophies = trophies || (select trophy from event_catalog where id = e.event_id) where faction = v_places->0->>'faction';
    end if;
    update events set closed = true, places = v_places where key = e.key;
  end loop;
  select * into slot from current_event_slot();
  if slot.event_id is not null then
    insert into events (key, event_id, start_at, end_at) values (slot.event_id || '@' || ms(slot.start_at), slot.event_id, slot.start_at, slot.end_at)
    on conflict (key) do nothing;
  end if;
end $$;

create or replace function public.get_world() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w world; ev events; res jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform resolve_due();
  select * into w from world where id = 1;
  select * into ev from events where not closed and now() between start_at and end_at order by start_at desc limit 1;
  res := jsonb_build_object(
    'v', 1, 'round', w.round, 'nextAt', ms(w.next_at),
    'points', (select jsonb_object_agg(id, jsonb_build_object('owner', owner, 'shieldRound', shield_round)) from map_points),
    'influence', (select jsonb_object_agg(faction, influence) from faction_world),
    'trophies', (select jsonb_object_agg(faction, to_jsonb(trophies)) from faction_world),
    'reports', coalesce((select jsonb_agg(x order by (x->>'round')::int desc) from (
        select jsonb_build_object('round', rd.round, 'at', ms(rd.at), 'results', rd.results,
          'my', (select jsonb_build_object('order', jsonb_build_object('kind', o.kind, 'point', o.point), 'won', coalesce(o.won, false), 'rating', coalesce(o.rating, 0), 's', coalesce(o.s, 0))
                 from orders o where o.player_id = auth.uid() and o.round = rd.round and o.kind is not null)) x
        from rounds rd order by rd.round desc limit 5) q), '[]'::jsonb),
    'event', case when ev.key is null then null else jsonb_build_object('id', ev.event_id, 'startAt', ms(ev.start_at), 'endAt', ms(ev.end_at),
      'scores', coalesce((select jsonb_agg(jsonb_build_object('name', pl.username, 'faction', pl.faction, 'score', es.score, 'me', es.player_id = auth.uid()) order by es.score desc)
        from event_scores es join players pl on pl.id = es.player_id where es.key = ev.key), '[]'::jsonb)) end,
    'eventResults', coalesce((select jsonb_agg(jsonb_build_object('id', event_id, 'endAt', ms(end_at), 'places', places) order by end_at desc)
        from (select * from events where closed order by end_at desc limit 10) z), '[]'::jsonb),
    'my_order', (select jsonb_build_object('kind', kind, 'point', point) from orders where player_id = auth.uid() and round = w.round and kind is not null),
    'my_order_round', w.round
  );
  return res;
end $$;

create or replace function public.set_order(p_kind text, p_point text, p_power int)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r int; me players; pt map_points;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform resolve_due();
  select round into r from world where id = 1;
  if p_kind is null then update orders set kind = null, point = null where player_id = uid and round = r; return; end if;
  select * into me from players where id = uid;
  select * into pt from map_points where id = p_point;
  if not found then raise exception 'Нет такой точки'; end if;
  if me.faction is null then raise exception 'Сначала выбери профбюро'; end if;
  if p_kind = 'attack' and pt.owner = me.faction then raise exception 'Это уже ваша точка — её можно только оборонять'; end if;
  if p_kind = 'attack' and pt.shield_round >= r then raise exception 'Точка под щитом до следующего раунда'; end if;
  if p_kind = 'defend' and pt.owner is distinct from me.faction then raise exception 'Оборонять можно только точки своего ПБ'; end if;
  if exists (select 1 from cooldowns where player_id = uid and round = r) then raise exception 'Активисты на мероприятии и пропускают этот раунд'; end if;
  insert into orders (player_id, round, kind, point, power) values (uid, r, p_kind, p_point, least(greatest(p_power, 0), me.power + 500))
  on conflict (player_id, round) do update set kind = excluded.kind, point = excluded.point, power = excluded.power;
end $$;

create or replace function public.set_law_share(p_share real)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select round into r from world where id = 1;
  insert into orders (player_id, round, law) values (uid, r, least(1, greatest(0, p_share)))
  on conflict (player_id, round) do update set law = case when orders.law > 0 then orders.law else excluded.law end;
end $$;

create or replace function public.submit_event_score(p_key text, p_score int)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ev events; r int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into ev from events where key = p_key and not closed and now() between start_at and end_at + interval '3 minutes';
  if not found then raise exception 'Мероприятие уже закончилось'; end if;
  if not exists (select 1 from event_scores where key = p_key and player_id = uid) then
    select round into r from world where id = 1;
    insert into cooldowns (player_id, round) values (uid, r) on conflict do nothing;
    update orders set kind = null, point = null where player_id = uid and round = r; -- активисты ушли на мероприятие
  end if;
  insert into event_scores (key, player_id, score) values (p_key, uid, greatest(0, least(p_score, 1000000)))
  on conflict (key, player_id) do update set score = greatest(event_scores.score, excluded.score);
end $$;

-- ---------- Задания ----------
drop function if exists public.claim_auto_task(text);
create or replace function public.claim_auto_task(p_task text, p_value int default null, p_text text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); amount int; g int; r int; t task_defs;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into t from task_defs where id = p_task;
  if p_task = 'case_day' then
    if not exists (select 1 from answers where player_id = uid and day = msk_day() and correct and question_id = case_of_day_id()) then
      raise exception 'Дело дня не решено';
    end if;
    if (select count(*) from answers where player_id = uid and day = msk_day() and question_id = case_of_day_id()) > 1 then
      return jsonb_build_object('granted', 0, 'rating', (select rating from players where id = uid));
    end if;
    amount := t.amount;
  elsif p_task in ('daily_login', 'profile', 'reflection') then
    amount := t.amount;
  elsif p_task = 'intro_quiz' then
    amount := t.amount * least(10, greatest(0, coalesce(p_value, 0)));
  elsif p_task = 'docs_quiz' then
    amount := t.amount * least(3, greatest(0, coalesce(p_value, 0)));
  elsif p_task = 'thought' then
    if length(btrim(coalesce(p_text, ''))) < 80 then raise exception 'Нужно хотя бы 80 символов'; end if;
    amount := t.amount;
  elsif p_task = 'tg_channel' then
    raise exception 'Проверка подписки включится, когда бот станет админом канала';
  else
    raise exception 'Это задание сдаётся по-другому';
  end if;
  g := _grant_task(uid, p_task, amount);
  if g > 0 and p_text is not null then
    insert into submissions (player_id, task, text, status, rating) values (uid, p_task, left(p_text, 4000), 'approved', g);
  end if;
  select rating into r from players where id = uid;
  return jsonb_build_object('granted', g, 'rating', r);
end $$;

create or replace function public.submit_task(p_task text, p_text text, p_photo text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_task not in ('vk_group', 'story', 'grant', 'brand', 'sponsor', 'press', 'photo') then raise exception 'Это задание не сдаётся на модерацию'; end if;
  if exists (select 1 from submissions where player_id = uid and task = p_task and status = 'pending') then raise exception 'Уже на проверке'; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> uid::text then raise exception 'Чужое фото'; end if;
  insert into submissions (player_id, task, text, photo) values (uid, p_task, left(p_text, 4000), p_photo);
end $$;

create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); v_code text := upper(btrim(p_code)); eg egg_codes; ca cache_codes; other players; me players;
  g int := 0; msg text; n int; v_a uuid; v_b uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  select * into eg from egg_codes where egg_codes.code = v_code;
  if found then
    if exists (select 1 from egg_redeems where player_id = uid and egg_redeems.code = eg.code) then msg := 'Эту пасхалку ты уже нашёл';
    else
      g := _grant_task(uid, eg.task, eg.rating);
      if g > 0 then insert into egg_redeems (player_id, code) values (uid, eg.code); msg := 'Пасхалка! +' || g || ' рейтинга';
      else msg := 'Лимит по этому заданию исчерпан'; end if;
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  select * into ca from cache_codes where cache_codes.code = v_code;
  if found then
    if ca.gold then
      if exists (select 1 from cache_finds where cache_finds.code = ca.code) then msg := 'Золотой тайник уже нашли до тебя';
      else insert into cache_finds (player_id, code) values (uid, ca.code); g := _grant_task(uid, 'cache_gold', 100); msg := 'ЗОЛОТОЙ ТАЙНИК! +' || g; end if;
    elsif exists (select 1 from cache_finds where player_id = uid and cache_finds.code = ca.code) then msg := 'Тайник №' || ca.n || ' уже найден';
    else
      insert into cache_finds (player_id, code) values (uid, ca.code);
      g := _grant_task(uid, 'caches', 15);
      select count(*) into n from cache_finds cf join cache_codes cc on cc.code = cf.code where cf.player_id = uid and not cc.gold;
      if n = 10 then g := g + _grant_task(uid, 'bonus', 50, 'task', null, 'все 10 тайников'); end if;
      msg := 'Тайник №' || ca.n || ': +' || g || ' рейтинга';
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  if v_code like 'PB-%' then
    select * into other from players where player_code(id) = v_code;
    if not found then raise exception 'Код участника не найден'; end if;
    if other.id = uid then raise exception 'Это твой собственный код'; end if;
    v_a := least(uid, other.id); v_b := greatest(uid, other.id);
    if exists (select 1 from meets where meets.a = v_a and meets.b = v_b) then raise exception 'С этим человеком вы уже знакомы'; end if;
    insert into meets (a, b, by_player) values (v_a, v_b, uid);
    g := _grant_task(uid, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end);
    if g = 0 then raise exception 'На сегодня лимит знакомств — 20'; end if;
    perform _grant_task(other.id, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end); -- знакомство засчитывается обоим
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', 'Знакомство с ' || other.username || ': +' || g);
  end if;
  raise exception 'Код не подошёл';
end $$;

-- ---------- Организатор ----------
create or replace function public.staff_submissions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'player', p.username, 'playerId', p.id, 'faction', p.faction, 'task', s.task,
    'text', s.text, 'photo', s.photo, 'at', ms(s.created_at), 'status', s.status, 'rating', s.rating) order by s.created_at)
    from submissions s join players p on p.id = s.player_id where s.status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.staff_review(p_id bigint, p_ok boolean, p_rating int)
returns void language plpgsql security definer set search_path = public as $$
declare s submissions; g int := 0;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into s from submissions where id = p_id and status = 'pending' for update;
  if not found then return; end if;
  if p_ok then g := _grant_task(s.player_id, s.task, greatest(0, least(p_rating, 500)), 'staff', auth.uid()); end if;
  update submissions set status = case when p_ok then 'approved' else 'rejected' end, rating = g, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end $$;

create or replace function public.staff_find_players(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', username, 'faction', faction, 'rating', rating)) from (
    select * from players where username ilike '%' || p_q || '%' or player_code(id) = upper(p_q) order by username limit 20) q), '[]'::jsonb);
end $$;

drop function if exists public.staff_grant(uuid, int, text, text);
create or replace function public.staff_grant(p_player uuid, p_amount int, p_task text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  g := _grant_task(p_player, coalesce(p_task, 'bonus'), greatest(0, least(p_amount, 500)), 'staff', auth.uid(), p_note);
  if g = 0 then raise exception 'Лимит этого задания у участника уже исчерпан'; end if;
  return jsonb_build_object('granted', g);
end $$;

create or replace function public.staff_checkin(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p players; g int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into p from players where player_code(id) = upper(btrim(p_code));
  if not found then return jsonb_build_object('message', 'Код участника не найден'); end if;
  g := _grant_task(p.id, 'checkin', 30, 'staff', auth.uid());
  return jsonb_build_object('message', case when g > 0 then p.username || ' отмечен на заезде: +30' else p.username || ' уже отмечен' end);
end $$;

create or replace function public.staff_make_codes(p_n int, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb := '[]'::jsonb; c text; i int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  for i in 1 .. least(200, greatest(1, p_n)) loop
    c := upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4));
    insert into login_codes (code, note) values (c, nullif(p_note, '')) on conflict do nothing;
    res := res || to_jsonb(c);
  end loop;
  return res;
end $$;

create or replace function public.staff_force_round()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update world set next_at = now() - interval '1 second' where id = 1;
  perform resolve_due();
end $$;

/** Реферал: вызывает функция входа (service_role) при первом входе нового игрока. */
create or replace function public.apply_referral(p_new uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare inv players;
begin
  select * into inv from players where player_code(id) = upper(replace(coalesce(p_code, ''), 'ref_', ''));
  if not found or inv.id = p_new then return; end if;
  insert into referrals (invitee, inviter) values (p_new, inv.id) on conflict do nothing;
  if found then perform _grant_task(inv.id, 'invite', 15); end if;
end $$;

-- ---------- Рейтинг ПБ с влиянием ----------
drop function if exists public.faction_stats();
create or replace function public.faction_stats()
returns table (faction text, players bigint, rating bigint, influence int)
language sql stable security definer set search_path = public as $$
  select f.faction, count(p.id), coalesce(sum(p.rating), 0), coalesce(max(fw.influence), 0)
  from unnest(array['inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee']) as f(faction)
  left join players p on p.faction = f.faction and not p.is_staff
  left join faction_world fw on fw.faction = f.faction
  group by f.faction
  order by 3 desc
$$;

-- ---------- pg_cron: раунды и мероприятия даже без заходов в игру ----------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pb-resolve', '* * * * *', 'select public.resolve_due()');
exception when others then
  raise notice 'pg_cron недоступен — раунды считаются при открытии карты';
end $$;

-- ---------- Права ----------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.save_progress(jsonb, text, text, int, int),
  public.add_game_rating(text, int),
  public.get_questions(),
  public.check_answer(text, text),
  public.reveal_answer(text),
  public.claim_auto_task(text, int, text),
  public.leaderboard(),
  public.faction_stats(),
  public.get_world(),
  public.set_order(text, text, int),
  public.set_law_share(real),
  public.submit_event_score(text, int),
  public.submit_task(text, text, text),
  public.redeem_code(text),
  public.staff_submissions(),
  public.staff_review(bigint, boolean, int),
  public.staff_find_players(text),
  public.staff_grant(uuid, int, text, text),
  public.staff_checkin(text),
  public.staff_make_codes(int, text),
  public.staff_force_round(),
  public.staff_set_faction(uuid, text)
to authenticated;
grant execute on function public.apply_referral(uuid, text) to service_role;

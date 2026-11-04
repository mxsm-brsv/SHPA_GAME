-- v8: «Кнопка» для вечерних игр в стиле «Ты — лидер» — кто из команд нажал первым, честно при любой связи.
--
-- Как устроена честность:
-- 1. Телефон синхронизирует свои часы с часами сервера (как NTP): несколько коротких запросов bz_time(),
--    берутся самые быстрые, поправка = время сервера − середина запроса. Часы самого телефона не важны —
--    в расчёт идёт только монотонный таймер браузера.
-- 2. В момент касания телефон ставит метку «по часам сервера» и отправляет её. Сервер упорядочивает
--    команды по этим меткам, а не по времени прихода: медленный интернет задерживает только доставку.
-- 3. Каждый «пульс» телефона (раз в 0,5–1 с) говорит: «до момента T нажатий не было» (as_of_ms) и несёт
--    неподтверждённое нажатие, если оно есть. Место считается подтверждённым, когда все команды на связи
--    отчитались за момент позже этого нажатия, — так позднее нажатие не может «обогнать» объявленного лидера.
-- 4. Проверки правдоподобия: метка из будущего обрезается, нажатие до старта отклоняется, долгая доставка,
--    плохая синхронизация и «узнали о старте с опозданием» показываются ведущему значками.

create or replace function public.bz_ms() returns double precision language sql volatile as $$
  select extract(epoch from clock_timestamp())::double precision * 1000
$$;

/** Пинг для синхронизации часов: только время сервера, без обращений к таблицам. */
create or replace function public.bz_time() returns double precision language sql volatile as $$
  select extract(epoch from clock_timestamp())::double precision * 1000
$$;

create table if not exists public.bz_game (
  id int primary key default 1 check (id = 1),
  title text not null default 'Ты — лидер',
  v bigint not null default 1,                      -- версия состояния: растёт при любом изменении
  round_id int,
  teams_locked boolean not null default false,      -- выбор команд закрыт
  countdown_ms int not null default 3000 check (countdown_ms between 0 and 10000),
  limit_ms int not null default 0 check (limit_ms between 0 and 600000),   -- 0 — без лимита времени
  lockout_ms int not null default 1000 check (lockout_ms between 0 and 5000), -- блок за нажатие до старта
  pts_ok int not null default 1 check (pts_ok between 0 and 100),
  pts_bad int not null default 1 check (pts_bad between 0 and 100),
  auto_close boolean not null default true,         -- закрыть приём, когда нажали все команды
  host_code_hash text                               -- свой код ведущего (кроме кода организатора)
);
insert into public.bz_game (id) values (1) on conflict (id) do nothing;

create table if not exists public.bz_clients (
  id bigserial primary key,
  ident text not null unique,                       -- tg:<id> или web:<хэш ключа устройства>
  kind text not null check (kind in ('tg', 'web')),
  token_hash text not null unique,
  name text not null,
  username text,
  created_at timestamptz not null default now(),
  last_seen_ms double precision,                    -- когда пришёл последний пульс (часы сервера)
  as_of_ms double precision,                        -- «до этого момента нажатий не было» (часы сервера по оценке телефона)
  rtt_ms real,                                      -- пинг (лучший из последних)
  err_ms real,                                      -- точность синхронизации часов, ±мс
  seen_round int,
  seen_lag_ms real,                                 -- насколько позже старта телефон узнал о вопросе (<0 — заранее)
  app text
);

create table if not exists public.bz_teams (
  id serial primary key,
  num int not null,
  name text not null,
  active boolean not null default true,
  captain bigint references public.bz_clients(id) on delete set null,
  claimed_at timestamptz
);
create unique index if not exists bz_teams_captain on public.bz_teams (captain) where captain is not null;
create index if not exists bz_teams_num on public.bz_teams (num);

create table if not exists public.bz_rounds (
  id serial primary key,
  n int not null,
  status text not null default 'open' check (status in ('open', 'closed', 'void')),
  created_ms double precision not null,
  opens_ms double precision not null,
  closes_ms double precision,                       -- конец по лимиту времени
  closed_ms double precision,                       -- фактическое закрытие
  closed_by text
);

create table if not exists public.bz_presses (
  round_id int not null references public.bz_rounds(id) on delete cascade,
  team_id int not null references public.bz_teams(id) on delete cascade,
  client_id bigint references public.bz_clients(id) on delete set null,
  press_ms double precision not null,               -- момент касания по часам сервера
  sent_ms double precision not null,                -- что прислал телефон (до поправок)
  arrival_ms double precision not null,             -- когда дошло до сервера
  rtt_ms real,
  err_ms real,
  attempts int not null default 1,
  flags text[] not null default '{}',
  verdict text check (verdict in ('ok', 'bad')),
  points int not null default 0,
  primary key (round_id, team_id)
);

create table if not exists public.bz_adjust (
  id serial primary key,
  team_id int not null references public.bz_teams(id) on delete cascade,
  delta int not null,
  created_at timestamptz not null default now()
);
create table if not exists public.bz_hosts (token_hash text primary key, created_at timestamptz not null default now(), last_seen timestamptz);
create table if not exists public.bz_attempts (key text not null, at timestamptz not null default now());

alter table public.bz_game enable row level security;
alter table public.bz_clients enable row level security;
alter table public.bz_teams enable row level security;
alter table public.bz_rounds enable row level security;
alter table public.bz_presses enable row level security;
alter table public.bz_adjust enable row level security;
alter table public.bz_hosts enable row level security;
alter table public.bz_attempts enable row level security;
-- политик нет: читать и писать можно только через функции ниже

-- 10 профбюро МЭИ — заранее, ведущий меняет список в панели
insert into public.bz_teams (num, name)
select o, x
from unnest(array['ГПИ', 'ИВТИ', 'ИГВИЭ', 'ИнЭИ', 'ИРЭ', 'ИТАЭ', 'ИЭВТ', 'ИЭТЭ', 'ИЭЭ', 'ЭнМИ']) with ordinality u(x, o)
where not exists (select 1 from public.bz_teams);

-- ───────────────────────── служебное ─────────────────────────

create or replace function public._bz_hash(p text) returns text language sql immutable as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function public._bz_norm_code(p text) returns text language sql immutable as $$
  select replace(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), 'Ё', 'Е')
$$;

create or replace function public._bz_bump() returns void language sql volatile security definer set search_path = public as $$
  update bz_game set v = v + 1 where id = 1
$$;

create or replace function public._bz_client(p_token text) returns public.bz_clients language sql stable security definer set search_path = public as $$
  select * from bz_clients where token_hash = _bz_hash(p_token) and coalesce(p_token, '') <> ''
$$;

create or replace function public._bz_host_ok(p_token text) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare h text := _bz_hash(p_token);
begin
  if coalesce(p_token, '') = '' then return false; end if;
  update bz_hosts set last_seen = now() where token_hash = h and created_at > now() - interval '3 days';
  return found;
end $$;

-- ───────────────────────── регистрация ─────────────────────────

create or replace function public._bz_issue(p_ident text, p_kind text, p_name text, p_username text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); cid bigint;
  nm text := left(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), 40);
begin
  if nm is null then nm := 'Без имени'; end if;
  insert into bz_clients (ident, kind, token_hash, name, username)
  values (p_ident, p_kind, _bz_hash(tok), nm, left(nullif(btrim(coalesce(p_username, '')), ''), 40))
  on conflict (ident) do update set token_hash = excluded.token_hash, name = excluded.name, username = excluded.username,
    as_of_ms = null, last_seen_ms = null
  returning id into cid;
  return jsonb_build_object('ok', true, 'token', tok, 'id', cid, 'name', nm);
end $$;

/** Вход из Telegram — вызывает только функция knopka после проверки подписи initData. */
create or replace function public.bz_register(p_tg bigint, p_name text, p_username text) returns jsonb
language sql volatile security definer set search_path = public as $$
  select _bz_issue('tg:' || p_tg, 'tg', p_name, p_username)
$$;

/** Вход из браузера (без Telegram): имя вводит человек, у ведущего он отмечен как «браузер». */
create or replace function public.bz_register_web(p_device text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if length(coalesce(p_device, '')) < 16 then return jsonb_build_object('ok', false, 'error', 'Нет ключа устройства'); end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then return jsonb_build_object('ok', false, 'error', 'Напиши имя'); end if;
  if (select count(*) from bz_clients where created_at > now() - interval '1 minute') > 120 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много входов, попробуй через минуту');
  end if;
  return _bz_issue('web:' || left(_bz_hash(p_device), 32), 'web', p_name, null);
end $$;

-- ───────────────────────── состояние ─────────────────────────

/**
 * Снимок игры. p_host — для ведущего (капитаны, пинг, флаги), p_client — для телефона команды («мои» поля).
 * Порог «нет связи» — 3,5 с без пульса: такая команда не держит подтверждение, но видна ведущему.
 */
create or replace function public._bz_view(p_host boolean, p_client bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms();
  g bz_game; r bz_rounds; st text; cl_ms double precision; cl_by text;
  teams jsonb; rj jsonb := null; me jsonb := null; hist jsonb := null;
  w double precision; blockers int; waiting jsonb; offline jsonb; presses jsonb; settled boolean;
  off_ms constant double precision := 3500;
begin
  select * into g from bz_game where id = 1;

  select coalesce(jsonb_agg(x.j order by x.num), '[]'::jsonb) into teams from (
    select tm.num, jsonb_build_object(
        'id', tm.id, 'num', tm.num, 'name', tm.name,
        'score', coalesce((select sum(p.points) from bz_presses p join bz_rounds rr on rr.id = p.round_id
                            where p.team_id = tm.id and rr.status <> 'void'), 0)
               + coalesce((select sum(a.delta) from bz_adjust a where a.team_id = tm.id), 0),
        'claimed', tm.captain is not null,
        'online', c.last_seen_ms is not null and t - c.last_seen_ms < off_ms,
        'mine', coalesce(p_client is not null and tm.captain = p_client, false)
      ) || case when p_host and c.id is not null then jsonb_build_object(
        'captain', jsonb_build_object('name', c.name, 'username', c.username, 'kind', c.kind),
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

    -- водяной знак: до какого момента ВСЕ команды на связи без нажатия отчитались «не нажимали»
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
          -- разница меньше суммы погрешностей синхронизации двух телефонов: порядок не гарантирован
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

  if p_client is not null then
    select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind,
      'team', (select tm.id from bz_teams tm where tm.captain = c.id and tm.active)) into me
    from bz_clients c where c.id = p_client;
  end if;

  if p_host then
    select coalesce(jsonb_agg(h.j order by h.id desc), '[]'::jsonb) into hist from (
      select rr.id, jsonb_build_object('id', rr.id, 'n', rr.n, 'status', rr.status,
        'order', coalesce((select jsonb_agg(jsonb_build_object('team', p.team_id, 'verdict', p.verdict, 'points', p.points,
                    'rel_ms', round((p.press_ms - rr.opens_ms)::numeric)) order by p.press_ms, p.arrival_ms)
                  from bz_presses p where p.round_id = rr.id), '[]'::jsonb)) as j
      from bz_rounds rr where rr.id <> coalesce(g.round_id, -1) order by rr.id desc limit 30
    ) h;
  end if;

  return jsonb_build_object('v', g.v, 'game', jsonb_build_object('title', g.title, 'locked', g.teams_locked,
      'countdown_ms', g.countdown_ms, 'limit_ms', g.limit_ms, 'lockout_ms', g.lockout_ms, 'pts_ok', g.pts_ok,
      'pts_bad', g.pts_bad, 'auto_close', g.auto_close, 'own_code', g.host_code_hash is not null),
    'teams', teams, 'round', rj)
    || case when me is not null then jsonb_build_object('me', me) else '{}'::jsonb end
    || case when p_host then jsonb_build_object('history', hist) else '{}'::jsonb end;
end $$;

-- ───────────────────────── нажатие ─────────────────────────

create or replace function public._bz_press(p_client bigint, p_round int, p_ms double precision, p_rtt real, p_err real, p_attempts int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms(); tm bz_teams; r bz_rounds; g bz_game; ex bz_presses;
  ms double precision; fl text[] := '{}'; n_teams int; n_press int;
begin
  select * into tm from bz_teams where captain = p_client and active;
  if tm.id is null then return jsonb_build_object('ok', false, 'code', 'no_team', 'round', p_round); end if;
  if p_round is null or p_ms is null or p_ms <> p_ms or p_ms in ('infinity'::double precision, '-infinity'::double precision) then
    return jsonb_build_object('ok', false, 'code', 'bad', 'round', p_round);
  end if;
  -- порядок блокировок везде один: сначала bz_game, потом вопрос — одновременные нажатия идут по очереди
  select * into g from bz_game where id = 1 for update;
  select * into r from bz_rounds where id = p_round for update;
  if r.id is null or r.status = 'void' then return jsonb_build_object('ok', false, 'code', 'void', 'round', p_round); end if;
  select * into ex from bz_presses where round_id = r.id and team_id = tm.id;
  if found then
    return jsonb_build_object('ok', true, 'code', 'dup', 'round', r.id, 'press_ms', ex.press_ms);
  end if;

  ms := p_ms;
  -- метка «из будущего» (часы телефона ушли вперёд или подмена) — считаем по времени прихода
  if ms > t + 150 then fl := fl || 'future'::text; ms := t; end if;
  -- раньше старта: кнопка на телефоне в это время заблокирована, так что это сбой или подмена
  if ms < r.opens_ms - 25 then return jsonb_build_object('ok', false, 'code', 'early', 'round', r.id); end if;
  ms := greatest(ms, r.opens_ms);
  if r.closed_ms is not null and ms > r.closed_ms then return jsonb_build_object('ok', false, 'code', 'closed', 'round', r.id); end if;
  if r.closes_ms is not null and ms > r.closes_ms then return jsonb_build_object('ok', false, 'code', 'timeout', 'round', r.id); end if;
  -- долгая доставка: телефон был без связи или пытался много раз — ведущий видит значок
  if t - ms > greatest(3000, 4 * coalesce(p_rtt, 0)) then fl := fl || 'late'::text; end if;
  if coalesce(p_err, 0) > 150 then fl := fl || 'sync'::text; end if;
  -- телефон раньше отчитался «до момента T нажатий не было», а теперь прислал нажатие до T: подтверждённый
  -- лидер мог быть объявлен зря — ведущий видит значок (у честного телефона почти не бывает: запас 100 мс)
  if ms < (select as_of_ms from bz_clients where id = p_client) - 50 then fl := fl || 'asof'::text; end if;

  insert into bz_presses (round_id, team_id, client_id, press_ms, sent_ms, arrival_ms, rtt_ms, err_ms, attempts, flags)
  values (r.id, tm.id, p_client, ms, p_ms, t, p_rtt, p_err, greatest(1, least(coalesce(p_attempts, 1), 1000)), fl);
  perform _bz_bump();

  -- нажали все команды — приём закрывается сам
  if r.status = 'open' and g.auto_close and r.id = g.round_id then
    select count(*) into n_teams from bz_teams where active and captain is not null;
    select count(*) into n_press from bz_presses p join bz_teams x on x.id = p.team_id where p.round_id = r.id and x.active;
    if n_press >= n_teams then
      update bz_rounds set status = 'closed', closed_ms = t, closed_by = 'all' where id = r.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok', 'round', r.id, 'press_ms', ms, 'flags', to_jsonb(fl));
end $$;

/** Отдельное нажатие (телефон шлёт его сразу, а пульсы повторяют, пока сервер не подтвердит). */
create or replace function public.bz_press(p_token text, p_round int, p_ms double precision, p_rtt real default null,
  p_err real default null, p_attempts int default 1) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token);
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  return _bz_press(c.id, p_round, p_ms, p_rtt, p_err, p_attempts) || jsonb_build_object('t', bz_ms());
end $$;

-- ───────────────────────── пульс телефона ─────────────────────────

/**
 * Пульс: «я на связи, по часам сервера сейчас p_asof и нажатий до этого момента не было» (+ неподтверждённое
 * нажатие, если есть). Отвечает временем сервера (t0 — начало, t — конец обработки: для синхронизации берётся
 * середина) и состоянием, если оно поменялось или идёт вопрос.
 */
create or replace function public.bz_tick(p_token text, p_v bigint default 0, p_asof double precision default null,
  p_rtt real default null, p_err real default null, p_round int default null, p_seen double precision default null,
  p_press jsonb default null, p_app text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t0 double precision := bz_ms(); c bz_clients := _bz_client(p_token); g bz_game; pr jsonb := null; live boolean;
  opens double precision; res jsonb;
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

  -- идёт вопрос (или закончился меньше 15 с назад) — отдаём состояние каждый раз: места подтверждаются без смены версии
  select exists(select 1 from bz_rounds where id = g.round_id and status <> 'void'
                and ((status = 'open' and coalesce(closes_ms, 'infinity'::double precision) > t0 - 15000) or closed_ms > t0 - 15000)) into live;
  if p_v is distinct from g.v or live or pr is not null then
    res := _bz_view(false, c.id);
  else
    res := jsonb_build_object('v', g.v);
  end if;
  return res || jsonb_build_object('t0', t0, 't', bz_ms(), 'press', pr);
end $$;

create or replace function public.bz_claim(p_token text, p_team int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); tm bz_teams; g bz_game; cap bz_clients;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;
  select * into tm from bz_teams where id = p_team and active for update;
  if tm.id is null then return jsonb_build_object('ok', false, 'error', 'Такой команды нет'); end if;
  if tm.captain = c.id then return jsonb_build_object('ok', true); end if;
  if g.teams_locked then return jsonb_build_object('ok', false, 'error', 'Ведущий закрыл выбор команд. Подойди к ведущему.'); end if;
  if tm.captain is not null then
    select * into cap from bz_clients where id = tm.captain;
    return jsonb_build_object('ok', false, 'error', format('За команду «%s» уже играет %s. Если это ошибка — попроси ведущего освободить команду.', tm.name, cap.name));
  end if;
  update bz_teams set captain = null, claimed_at = null where captain = c.id;
  update bz_teams set captain = c.id, claimed_at = now() where id = tm.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bz_unclaim(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token);
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  perform 1 from bz_game where id = 1 for update;
  if (select teams_locked from bz_game where id = 1) and exists(select 1 from bz_teams where captain = c.id) then
    return jsonb_build_object('ok', false, 'error', 'Выбор команд закрыт — сменить команду может только ведущий');
  end if;
  update bz_teams set captain = null, claimed_at = null where captain = c.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── ведущий ─────────────────────────

/** Вход ведущего: код организатора игры ШПА или свой код кнопки. 8 ошибок за 15 минут — пауза. */
create or replace function public.bz_host_login(p_code text, p_key text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare k text := 'bzh:' || left(coalesce(p_key, ''), 64); code text := _bz_norm_code(p_code); g bz_game; tok text;
  staff text := _bz_norm_code(setting_text('staff_code', ''));
begin
  delete from bz_attempts where at < now() - interval '15 minutes';
  if (select count(*) from bz_attempts where key = k) >= 8 or (select count(*) from bz_attempts) >= 200 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много попыток — подожди 15 минут');
  end if;
  select * into g from bz_game where id = 1;
  if code = '' or not ((staff <> '' and code = staff) or (g.host_code_hash is not null and _bz_hash(code) = g.host_code_hash)) then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', 'Неверный код');
  end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into bz_hosts (token_hash) values (_bz_hash(tok));
  delete from bz_hosts where created_at < now() - interval '3 days';
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.bz_host_state(p_host text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t0 double precision := bz_ms();
begin
  if not _bz_host_ok(p_host) then return jsonb_build_object('error', 'auth'); end if;
  return _bz_view(true, null) || jsonb_build_object('t0', t0, 't', bz_ms());
end $$;

/** Экран для зала (проектор): без капитанов и технических подробностей, без входа. */
create or replace function public.bz_screen() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t0 double precision := bz_ms();
begin
  return _bz_view(false, null) || jsonb_build_object('t0', t0, 't', bz_ms());
end $$;

/** Все действия ведущего — одной функцией. Возвращает свежее состояние. */
create or replace function public.bz_host(p_host text, p_act text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms(); g bz_game; rid int; n int; tid int; v text; names text[]; i int; nm text;
  cd int; code text; a jsonb := coalesce(p_arg, '{}'::jsonb);
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
    -- переиграть вопрос: нажатия и баллы этого вопроса не считаются, номер вопроса не тратится
    update bz_rounds set status = 'void', closed_ms = coalesce(closed_ms, t), closed_by = coalesce(closed_by, 'void')
      where id = g.round_id;

  elsif p_act = 'verdict' then
    rid := coalesce((a->>'round')::int, g.round_id); tid := (a->>'team')::int; v := a->>'v';
    if v is not null and v not in ('ok', 'bad') then return jsonb_build_object('error', 'bad verdict'); end if;
    update bz_presses set verdict = v,
      points = case v when 'ok' then g.pts_ok when 'bad' then -g.pts_bad else 0 end
      where round_id = rid and team_id = tid;
    if not found then return jsonb_build_object('error', 'Эта команда не нажимала'); end if;
    -- верный ответ — вопрос закрыт
    if v = 'ok' then
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
      update bz_teams set name = nm, active = true where num = i;
      if not found then insert into bz_teams (num, name) values (i, nm); end if;
    end loop;
    update bz_teams set active = false, captain = null, claimed_at = null where num > array_length(names, 1);

  elsif p_act = 'release' then
    update bz_teams set captain = null, claimed_at = null where id = (a->>'team')::int;
  elsif p_act = 'release_all' then
    update bz_teams set captain = null, claimed_at = null where captain is not null;
  elsif p_act = 'lock' then
    update bz_game set teams_locked = coalesce((a->>'on')::boolean, not teams_locked) where id = 1;

  elsif p_act = 'settings' then
    -- greatest/least пропускают null, поэтому каждое поле меняем, только если оно пришло
    update bz_game set
      title = case when a ? 'title' and btrim(a->>'title') <> '' then left(btrim(a->>'title'), 60) else title end,
      countdown_ms = case when a ? 'countdown_ms' then greatest(0, least(10000, (a->>'countdown_ms')::int)) else countdown_ms end,
      limit_ms = case when a ? 'limit_ms' then greatest(0, least(600000, (a->>'limit_ms')::int)) else limit_ms end,
      lockout_ms = case when a ? 'lockout_ms' then greatest(0, least(5000, (a->>'lockout_ms')::int)) else lockout_ms end,
      pts_ok = case when a ? 'pts_ok' then greatest(0, least(100, (a->>'pts_ok')::int)) else pts_ok end,
      pts_bad = case when a ? 'pts_bad' then greatest(0, least(100, (a->>'pts_bad')::int)) else pts_bad end,
      auto_close = case when a ? 'auto_close' then (a->>'auto_close')::boolean else auto_close end
    where id = 1;

  elsif p_act = 'new_game' then
    -- новая игра: вопросы, нажатия и счёт с нуля; команды и капитаны остаются
    update bz_game set round_id = null where id = 1;
    delete from bz_presses; delete from bz_rounds; delete from bz_adjust;

  elsif p_act = 'host_code' then
    code := _bz_norm_code(a->>'code');
    if code = '' then update bz_game set host_code_hash = null where id = 1;
    elsif length(code) < 4 then return jsonb_build_object('error', 'Код — минимум 4 символа');
    else update bz_game set host_code_hash = _bz_hash(code) where id = 1;
    end if;

  elsif p_act = 'logout_others' then
    delete from bz_hosts where token_hash <> _bz_hash(p_host);

  else
    return jsonb_build_object('error', 'Неизвестное действие');
  end if;

  perform _bz_bump();
  return _bz_view(true, null) || jsonb_build_object('t', bz_ms());
end $$;

-- ───────────────────────── доступ ─────────────────────────

revoke all on function public._bz_hash(text), public._bz_norm_code(text), public._bz_bump(), public._bz_client(text),
  public._bz_host_ok(text), public._bz_issue(text, text, text, text), public._bz_view(boolean, bigint),
  public._bz_press(bigint, int, double precision, real, real, int), public.bz_register(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.bz_register(bigint, text, text) to service_role;
grant execute on function public.bz_time(), public.bz_ms(), public.bz_register_web(text, text),
  public.bz_tick(text, bigint, double precision, real, real, int, double precision, jsonb, text),
  public.bz_press(text, int, double precision, real, real, int), public.bz_claim(text, int), public.bz_unclaim(text),
  public.bz_host_login(text, text), public.bz_host_state(text), public.bz_screen(), public.bz_host(text, text, jsonb)
  to anon, authenticated;

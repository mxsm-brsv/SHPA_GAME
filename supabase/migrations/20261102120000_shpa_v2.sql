-- ШПА v2: список выезда и вход по ФИО, ПБ как клан (общие здания), магазин мерча, отметки на блоках по обновляемому QR,
-- обновляемый личный QR, эфир, открытая «Подготовка», настройки для теста.
-- Формулы повторяют клиент: src/config/clan.ts, src/config/merch.ts, src/core/codes.ts — менять вместе.

create extension if not exists pgcrypto with schema extensions;

insert into public.settings (key, value) values
  ('shop_open', 'false'),
  ('require_group', 'true'),
  ('staff_code', '"ORG-TEST"'),      -- поменять перед выездом: update settings set value = '"НОВЫЙ-КОД"' where key = 'staff_code';
  ('pb_limit', '7'),
  ('event_minutes_test', '20'),
  ('score_influence_weight', '3'),
  ('score_xp_div', '20'),
  ('contrib_daily_cap', '12000')
on conflict (key) do nothing;
update public.settings set value = '10' where key = 'round_minutes' and value = '20';

-- ---------- Список выезда ----------
create table if not exists public.roster (
  id bigint generated always as identity primary key,
  fio text not null,
  fio_norm text not null unique,
  grp text not null default '',
  grp_norm text not null default '',
  faction text not null check (faction in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee','profkom')),
  role text not null default 'participant' check (role in ('participant','staff','admin')),
  position text,
  tg_id bigint unique,
  device_hash text,
  player_id uuid unique references public.players(id) on delete set null,
  bound_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.login_attempts (key text not null, ok boolean not null, at timestamptz not null default now());
create index if not exists login_attempts_key on public.login_attempts (key, at);

alter table public.players add column if not exists roster_id bigint unique references public.roster(id) on delete set null;
alter table public.players add column if not exists role text not null default 'participant';
alter table public.players add column if not exists secret text not null default encode(extensions.gen_random_bytes(16), 'hex');
alter table public.players add column if not exists contributed int not null default 0;
alter table public.players add column if not exists contrib_at timestamptz;
alter table public.players add column if not exists contrib_day date;
alter table public.players add column if not exists contrib_day_xp int not null default 0;
alter table public.players add column if not exists power_at timestamptz;

-- ---------- ПБ как клан ----------
create table if not exists public.pb_buildings (
  faction text not null,
  building text not null check (building in ('kassa','shtab','media')),
  xp bigint not null default 0,
  primary key (faction, building)
);
insert into public.pb_buildings (faction, building)
  select f, b from unnest(array['inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee','profkom']) f, unnest(array['kassa','shtab','media']) b
on conflict do nothing;

-- ---------- Мерч ----------
create table if not exists public.merch_items (
  id text primary key default substr(md5(random()::text), 1, 8),
  name text not null,
  emoji text not null default '🎁',
  descr text not null default '',
  price int not null check (price > 0),
  stock int not null default 0 check (stock >= 0),
  total int not null default 0,
  per_person int not null default 1 check (per_person >= 1),
  discount int not null default 0 check (discount between 0 and 90),
  auto_hours real,
  auto_step int,
  auto_max int,
  last_sale_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.merch_orders (
  id text primary key,
  item_id text not null references public.merch_items(id),
  player_id uuid not null references public.players(id) on delete cascade,
  price int not null,
  status text not null default 'reserved' check (status in ('reserved','issued','cancelled')),
  created_at timestamptz not null default now(),
  done_by uuid,
  done_at timestamptz
);
create index if not exists merch_orders_player on public.merch_orders (player_id);

-- ---------- Блоки (отметка по QR) ----------
create table if not exists public.lectures (
  id text primary key,
  title text not null,
  points int not null,
  secret text not null,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  opened_by uuid,
  bonus_given text[] not null default '{}'
);
create table if not exists public.lecture_claims (
  lecture_id text not null references public.lectures(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (lecture_id, player_id)
);

-- ---------- Эфир ----------
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  text text not null,
  kind text not null default 'info' check (kind in ('info','alert','win')),
  created_at timestamptz not null default now(),
  until timestamptz,
  author uuid
);

insert into public.task_defs (id, amount, lim) values ('lecture', 15, '30') on conflict (id) do update set amount = excluded.amount, lim = excluded.lim;
update public.task_defs set lim = 'once' where id = 'invite';

alter table public.roster enable row level security;
alter table public.login_attempts enable row level security;
alter table public.pb_buildings enable row level security;
alter table public.merch_items enable row level security;
alter table public.merch_orders enable row level security;
alter table public.lectures enable row level security;
alter table public.lecture_claims enable row level security;
alter table public.announcements enable row level security;

-- ---------- Вспомогательные ----------
create or replace function public.setting_bool(k text, dflt boolean) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = k), dflt)
$$;
create or replace function public.setting_text(k text, dflt text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from settings where key = k), dflt)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from players where id = auth.uid()), false)
$$;

create or replace function public.norm_fio(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(replace(lower(coalesce(t, '')), 'ё', 'е'), '[^a-zа-я ]', ' ', 'g'), '\s+', ' ', 'g'))
$$;
create or replace function public.norm_group(t text) returns text language sql immutable as $$
  select regexp_replace(translate(replace(lower(coalesce(t, '')), 'ё', 'е'), 'abcehkmoptxy', 'авсенкмортху'), '[^0-9а-я]', '', 'g')
$$;

/** Обновляемый код: 6 символов из HMAC-SHA256(секрет, номер интервала). Как rotCode в src/core/codes.ts. */
create or replace function public.rot_code(p_secret text, p_slot bigint) returns text language sql immutable set search_path = public, extensions as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(x.h, i) % 31) + 1, 1), '' order by i)
  from (select extensions.hmac(p_slot::text, p_secret, 'sha256') h) x, generate_series(0, 5) i
$$;
create or replace function public.code_clean(t text) returns text language sql immutable as $$
  select regexp_replace(translate(upper(coalesce(t, '')), 'АВЕКМНОРСТУХавекмнорстух', 'ABEKMHOPCTYXABEKMHOPCTYX'), '[^A-Z0-9]', '', 'g')
$$;
/** Разбор содержимого QR: ссылка t.me/...?startapp=lec_КОД, «SHPA:L:КОД», «SHPA:P:КОД» или просто код. */
create or replace function public.parse_scan(t text, out kind text, out code text) language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(t, ''), 'startapp=(lec|p)_([A-Za-z0-9]+)');
  if m is null then m := regexp_match(coalesce(t, ''), 'SHPA:(L|P):([A-Za-z0-9]+)', 'i'); end if;
  if m is not null then
    kind := case when lower(m[1]) in ('lec', 'l') then 'lecture' else 'person' end;
    code := code_clean(m[2]);
  else
    kind := 'any';
    code := code_clean(t);
  end if;
end $$;

create or replace function public.player_by_code(p_code text) returns uuid language sql stable security definer set search_path = public as $$
  with s as (select floor(extract(epoch from now()) / 30)::bigint as slot)
  select p.id from players p, s
  where length(p_code) = 6 and p.roster_id is not null and (rot_code(p.secret, s.slot) = p_code or rot_code(p.secret, s.slot - 1) = p_code)
  limit 1
$$;

/** Уровень здания: порог уровня L — 150·L^1,7 опыта (как buildingLevel в src/config/clan.ts). */
create or replace function public.building_level(xp bigint) returns int language plpgsql immutable as $$
declare l int := 0;
begin
  while l < 20 and xp >= round(150 * power(l + 1, 1.7)) loop l := l + 1; end loop;
  return l;
end $$;
create or replace function public.ratusha_level(fac text) returns int language sql stable security definer set search_path = public as $$
  select least(10, 1 + floor(coalesce(sum(building_level(xp)), 0) / 4)::int) from pb_buildings where faction = fac
$$;

-- Сила в стычке: S = A × (1 + 0,05·R) × (1 + B) × (1 + 0,2·Q); R — ратуша ПБ (общая), в B добавлен Штаб (+4% за уровень).
create or replace function public.strike_power(fac text, kind text, power int, stage int, law real) returns numeric
language sql stable security definer set search_path = public as $$
  select power * (1 + 0.05 * ratusha_level(fac))
    * (1 + case when kind = 'attack' then case fac when 'ire' then 0.10 when 'enmi' then 0.06 else 0 end
                else case fac when 'iete' then 0.10 when 'iee' then 0.15 else 0 end end
         + 0.04 * coalesce((select building_level(xp) from pb_buildings b where b.faction = fac and b.building = 'shtab'), 0))
    * (1 + 0.2 * least(1, greatest(0, law)))
$$;

-- ---------- Вход по ФИО (вызывает edge-функция auth с service_role) ----------
create or replace function public.roster_tol(w text) returns int language sql immutable as $$
  select case when length(w) >= 6 then 1 else 0 end
$$;

/** Ищет строку списка по ФИО (порядок слов любой, одна опечатка в длинных словах) и группе. */
create or replace function public.roster_find(p_fio text, p_group text, p_staff boolean)
returns setof public.roster language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t text[] := string_to_array(norm_fio(p_fio), ' ');
  r roster; rt text[]; ok_s boolean; ok_n boolean; g text := norm_group(p_group); need_g boolean := setting_bool('require_group', true);
  i int; j int;
begin
  if coalesce(array_length(t, 1), 0) < 2 then return; end if;
  for r in select * from roster where (p_staff and role in ('staff', 'admin')) or (not p_staff and role = 'participant') loop
    rt := string_to_array(r.fio_norm, ' ');
    ok_s := false; ok_n := false;
    for i in 1 .. array_length(t, 1) loop
      for j in 1 .. array_length(t, 1) loop
        if i <> j and levenshtein(t[i], rt[1]) <= roster_tol(rt[1]) and levenshtein(t[j], rt[2]) <= roster_tol(rt[2]) then ok_s := true; ok_n := true; end if;
        -- запасной вариант: имя + отчество (если в фамилии опечатка посерьёзнее)
        if not ok_s and array_length(rt, 1) >= 3 and i <> j and t[i] = rt[2] and t[j] = rt[3] then ok_s := true; ok_n := true; end if;
      end loop;
    end loop;
    if not (ok_s and ok_n) then continue; end if;
    if not p_staff and need_g then
      if g = '' or regexp_replace(g, '\D', '', 'g') <> regexp_replace(r.grp_norm, '\D', '', 'g') or levenshtein(g, r.grp_norm) > 2 then continue; end if;
    end if;
    return next r;
  end loop;
end $$;

create or replace function public.roster_login(p_fio text, p_group text, p_staff_code text, p_tg_id bigint, p_device text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r roster; n int; fails int; staff boolean := coalesce(btrim(p_staff_code), '') <> ''; lim int := setting_int('pb_limit', 7);
  bound int; first boolean := false; parts text[];
begin
  select count(*) into fails from login_attempts where key = coalesce(p_key, '') and not ok and at > now() - interval '15 minutes';
  if fails >= 8 then return jsonb_build_object('error', 'Слишком много попыток. Подожди 15 минут или подойди к организаторам.'); end if;

  -- Telegram уже привязан — входим без ФИО
  if p_tg_id is not null then
    select * into r from roster where tg_id = p_tg_id;
    if found then
      insert into login_attempts (key, ok) values (coalesce(p_key, ''), true);
      parts := string_to_array(r.fio, ' ');
      return jsonb_build_object('ok', true, 'roster_id', r.id, 'faction', r.faction, 'role', r.role, 'name', coalesce(parts[2] || ' ', '') || parts[1]);
    end if;
    if coalesce(btrim(p_fio), '') = '' then return jsonb_build_object('needFio', true); end if;
  end if;
  if coalesce(btrim(p_fio), '') = '' then return jsonb_build_object('needFio', true); end if;

  if staff and p_staff_code <> setting_text('staff_code', '') then
    insert into login_attempts (key, ok) values (coalesce(p_key, ''), false);
    return jsonb_build_object('error', 'Неверный код организатора');
  end if;

  select count(*) into n from roster_find(p_fio, p_group, staff);
  if n = 0 then
    insert into login_attempts (key, ok) values (coalesce(p_key, ''), false);
    return jsonb_build_object('error', case when staff then 'Не нашли тебя в составе. Проверь фамилию и имя.'
      else 'Не нашли тебя в списке выезда. Проверь ФИО и группу. Если всё верно — подойди к организаторам.' end);
  end if;
  if n > 1 then return jsonb_build_object('error', 'Нашли несколько похожих — напиши ФИО полностью, с отчеством.'); end if;
  select * into r from roster_find(p_fio, p_group, staff) limit 1;

  -- привязка: первый вход закрепляет человека за Telegram или устройством
  if p_tg_id is not null then
    if r.tg_id is null and r.device_hash is null then first := true;
    elsif r.tg_id is distinct from p_tg_id then
      insert into login_attempts (key, ok) values (coalesce(p_key, ''), false);
      return jsonb_build_object('error', 'Под этим ФИО уже вошли с другого аккаунта. Если это не ты — подойди к организаторам, они сбросят вход.');
    end if;
  else
    if coalesce(p_device, '') = '' then return jsonb_build_object('error', 'Не удалось определить устройство — обнови страницу'); end if;
    if r.tg_id is null and r.device_hash is null then first := true;
    elsif r.device_hash is distinct from p_device then
      insert into login_attempts (key, ok) values (coalesce(p_key, ''), false);
      return jsonb_build_object('error', 'Под этим ФИО уже вошли с другого устройства или из Telegram. Открой игру там или попроси организаторов сбросить вход.');
    end if;
  end if;

  if first and r.role = 'participant' then
    perform pg_advisory_xact_lock(hashtext('pb:' || r.faction));
    select count(*) into bound from roster where faction = r.faction and role = 'participant' and (tg_id is not null or device_hash is not null);
    if bound >= lim then return jsonb_build_object('error', 'В этом ПБ уже ' || lim || ' игроков. Подойди к организаторам.'); end if;
  end if;
  if first then
    update roster set tg_id = p_tg_id, device_hash = case when p_tg_id is null then p_device end, bound_at = now() where id = r.id;
  end if;
  insert into login_attempts (key, ok) values (coalesce(p_key, ''), true);
  parts := string_to_array(r.fio, ' ');
  return jsonb_build_object('ok', true, 'roster_id', r.id, 'faction', r.faction, 'role', r.role, 'first', first, 'name', coalesce(parts[2] || ' ', '') || parts[1]);
end $$;

/** После создания сессии: связать игрока со строкой списка. Если всё ПБ в игре — каждому +15 (задание «Собрать всё ПБ»). */
create or replace function public.roster_attach(p_roster bigint, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r roster; parts text[]; nm text; total int; joined int; m record;
begin
  select * into r from roster where id = p_roster;
  if not found then raise exception 'no roster row'; end if;
  parts := string_to_array(r.fio, ' ');
  nm := left(coalesce(parts[2] || ' ', '') || parts[1], 40);
  insert into players (id, username, faction, role, is_staff, roster_id) values (p_player, nm, r.faction, r.role, r.role <> 'participant', r.id)
  on conflict (id) do update set username = excluded.username, faction = excluded.faction, role = excluded.role, is_staff = excluded.is_staff, roster_id = excluded.roster_id;
  update roster set player_id = p_player where id = r.id;
  if r.role = 'participant' then
    select count(*), count(player_id) into total, joined from roster where faction = r.faction and role = 'participant';
    if total > 0 and joined = total then
      for m in select player_id from roster where faction = r.faction and role = 'participant' and player_id is not null loop
        perform _grant_task(m.player_id, 'invite', 15);
      end loop;
    end if;
  end if;
end $$;

-- ---------- Игрок ----------
create or replace function public.me() returns jsonb language plpgsql security definer set search_path = public as $$
declare p players;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = auth.uid();
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  return jsonb_build_object('id', p.id, 'username', p.username, 'faction', p.faction, 'rating', p.rating, 'state', p.state,
    'role', p.role, 'secret', p.secret, 'contributed', p.contributed);
end $$;

create or replace function public.my_secret() returns text language sql stable security definer set search_path = public as $$
  select secret from players where id = auth.uid()
$$;

drop function if exists public.save_progress(jsonb, text, text, int, int);
/** Прогресс хранит клиент, но сила и этап растут не быстрее разумного (защита стычек от подмены). */
create or replace function public.save_progress(p_state jsonb, p_power int, p_stage int)
returns void language plpgsql security definer set search_path = public as $$
declare p players; hrs numeric; maxp numeric; maxs int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if octet_length(p_state::text) > 200000 then raise exception 'state too large'; end if;
  select * into p from players where id = auth.uid() for update;
  if not found or p.roster_id is null then raise exception 'not in roster'; end if;
  hrs := least(2, extract(epoch from now() - coalesce(p.power_at, p.updated_at, now() - interval '1 hour')) / 3600.0);
  maxp := greatest(p.power, 600) + (greatest(p.power, 600) * 0.6 + 4000) * greatest(hrs, 0.02);
  maxs := p.stage + 2 + floor(hrs * 360)::int;
  update players set
    state = p_state,
    power = greatest(0, least(coalesce(p_power, 0), maxp::int)),
    stage = greatest(1, least(coalesce(p_stage, 1), maxs, 51)),
    power_at = now(),
    updated_at = now()
  where id = auth.uid();
end $$;

create or replace function public.get_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('shopOpen', setting_bool('shop_open', false) or test_mode(), 'testMode', test_mode(), 'requireGroup', setting_bool('require_group', true))
$$;

-- ---------- ПБ: клан ----------
create or replace function public.clan_json(fac text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'faction', fac,
    'limit', setting_int('pb_limit', 7),
    'xp', (select jsonb_object_agg(building, xp) from pb_buildings where faction = fac),
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', username, 'rating', rating, 'contributed', contributed, 'me', id = auth.uid()) order by contributed desc)
      from players where faction = fac and roster_id is not null), '[]'::jsonb))
$$;

create or replace function public.get_clan() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare fac text;
begin
  select faction into fac from players where id = auth.uid() and roster_id is not null;
  if fac is null then return null; end if;
  return clan_json(fac);
end $$;

/** Вклад в здание ПБ. Не больше 15 опыта в секунду с прошлой отправки (+300 запас) и не больше дневного лимита. */
create or replace function public.contribute(p_building text, p_xp int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; allowed int; d date := msk_day(); cap int := setting_int('contrib_daily_cap', 12000); day_xp int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_building not in ('kassa', 'shtab', 'media') then raise exception 'unknown building'; end if;
  select * into p from players where id = uid for update;
  if not found or p.roster_id is null or p.faction is null then raise exception 'not in roster'; end if;
  day_xp := case when p.contrib_day = d then p.contrib_day_xp else 0 end;
  allowed := greatest(0, least(coalesce(p_xp, 0),
    300 + floor(extract(epoch from now() - coalesce(p.contrib_at, now() - interval '60 seconds')) * 15)::int,
    cap - day_xp));
  if allowed > 0 then
    update pb_buildings set xp = xp + allowed where faction = p.faction and building = p_building;
    update players set contributed = contributed + allowed, contrib_at = now(), contrib_day = d, contrib_day_xp = day_xp + allowed where id = uid;
  end if;
  -- ответ лёгкий (без списка участников): вклад отправляется часто, бережём трафик бесплатного тарифа
  return jsonb_build_object('accepted', allowed, 'contributed', p.contributed + allowed,
    'clan', jsonb_build_object('faction', p.faction, 'limit', setting_int('pb_limit', 7), 'xp', (select jsonb_object_agg(building, xp) from pb_buildings where faction = p.faction)));
end $$;

/** Рейтинг: участники (баллы и вклад) и ПБ (очки ПБ = Σ баллов + влияние × 3 + опыт зданий ÷ 20). */
create or replace function public.leaderboard2() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'players', coalesce((select jsonb_agg(jsonb_build_object('name', username, 'faction', faction, 'rating', rating, 'contributed', contributed, 'power', power, 'me', id = auth.uid()) order by rating desc)
      from (select * from players where roster_id is not null and role = 'participant' and faction <> 'profkom' order by rating desc limit 150) q), '[]'::jsonb),
    'factions', (select jsonb_agg(x order by (x->>'score')::numeric desc) from (
      select jsonb_build_object('faction', f.faction, 'players', count(p.id), 'limit', setting_int('pb_limit', 7), 'rating', coalesce(sum(p.rating), 0),
        'influence', coalesce(max(fw.influence), 0), 'xp', coalesce(max(b.xp), 0), 'ratusha', ratusha_level(f.faction),
        'score', round(coalesce(sum(p.rating), 0) + coalesce(max(fw.influence), 0) * setting_int('score_influence_weight', 3) + coalesce(max(b.xp), 0) / greatest(1, setting_int('score_xp_div', 20)))) x
      from unnest(array['inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee']) as f(faction)
      left join players p on p.faction = f.faction and p.roster_id is not null and p.role = 'participant'
      left join faction_world fw on fw.faction = f.faction
      left join (select faction, sum(xp) xp from pb_buildings group by faction) b on b.faction = f.faction
      group by f.faction) z)
  )
$$;

-- ---------- Мерч ----------
create or replace function public.merch_price(it public.merch_items) returns int language sql stable as $$
  select greatest(1, ceil(it.price * (1 - greatest(it.discount,
    case when coalesce(it.auto_hours, 0) > 0 and it.stock > 0
      then least(coalesce(it.auto_max, 0), greatest(0, floor(extract(epoch from now() - it.last_sale_at) / (it.auto_hours * 3600)))::int * coalesce(it.auto_step, 0))
      else 0 end) / 100.0)))::int
$$;
create or replace function public.merch_json(it public.merch_items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', it.id, 'name', it.name, 'emoji', it.emoji, 'text', it.descr, 'price', it.price, 'stock', it.stock, 'total', it.total,
    'perPerson', it.per_person, 'discount', it.discount, 'active', it.active, 'lastSaleAt', ms(it.last_sale_at),
    'auto', case when coalesce(it.auto_hours, 0) > 0 then jsonb_build_object('afterHours', it.auto_hours, 'stepPct', it.auto_step, 'maxPct', it.auto_max) end)
$$;
create or replace function public.order_json(o public.merch_orders) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'itemId', o.item_id, 'itemName', i.name, 'emoji', i.emoji, 'price', o.price, 'at', ms(o.created_at), 'status', o.status,
    'player', p.username, 'playerId', p.id, 'faction', p.faction)
  from merch_items i, players p where i.id = o.item_id and p.id = o.player_id
$$;

create or replace function public.merch_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(merch_json(i) order by i.price), '[]'::jsonb) from merch_items i where i.active
$$;
create or replace function public.my_wallet() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('earned', p.rating, 'spent', s.spent, 'balance', p.rating - s.spent)
  from players p, lateral (select coalesce(sum(price), 0)::int spent from merch_orders where player_id = p.id and status <> 'cancelled') s
  where p.id = auth.uid()
$$;
create or replace function public.my_orders() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(order_json(o) order by o.created_at desc), '[]'::jsonb) from merch_orders o where o.player_id = auth.uid()
$$;

create or replace function public.merch_buy(p_item text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it merch_items; p players; price int; spent int; mine int; oid text; o merch_orders;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- в тест-режиме магазин открыт всегда, чтобы проверить покупки
  if not (setting_bool('shop_open', false) or test_mode()) then raise exception 'Магазин мерча ещё закрыт'; end if;
  select * into p from players where id = uid;
  if p.roster_id is null then raise exception 'not in roster'; end if;
  if p.role <> 'participant' then raise exception 'Организаторы играют вне зачёта и мерч не покупают'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  select * into it from merch_items where id = p_item and active for update;
  if not found then raise exception 'Товар не найден'; end if;
  if it.stock <= 0 then raise exception 'Закончилось — кто-то успел раньше'; end if;
  select count(*) into mine from merch_orders where player_id = uid and item_id = it.id and status <> 'cancelled';
  if mine >= it.per_person then raise exception 'В одни руки — % шт.', it.per_person; end if;
  price := merch_price(it);
  select coalesce(sum(o2.price), 0) into spent from merch_orders o2 where o2.player_id = uid and o2.status <> 'cancelled';
  if p.rating - spent < price then raise exception 'Не хватает % баллов', price - (p.rating - spent); end if;
  loop
    oid := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from merch_orders where id = oid);
  end loop;
  insert into merch_orders (id, item_id, player_id, price) values (oid, it.id, uid, price) returning * into o;
  update merch_items set stock = stock - 1, last_sale_at = now() where id = it.id;
  return order_json(o);
end $$;

create or replace function public.staff_merch_save(p_item jsonb) returns void language plpgsql security definer set search_path = public as $$
declare v_id text := p_item->>'id'; ex merch_items;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into ex from merch_items where id = v_id;
  if found then
    update merch_items set
      name = coalesce(p_item->>'name', name), emoji = coalesce(p_item->>'emoji', emoji), descr = coalesce(p_item->>'text', descr),
      price = greatest(1, coalesce((p_item->>'price')::int, price)),
      stock = greatest(0, coalesce((p_item->>'stock')::int, stock)),
      total = greatest(total, coalesce((p_item->>'stock')::int, stock)),
      per_person = greatest(1, coalesce((p_item->>'perPerson')::int, per_person)),
      discount = least(90, greatest(0, coalesce((p_item->>'discount')::int, discount))),
      auto_hours = case when p_item ? 'auto' then (p_item->'auto'->>'afterHours')::real else auto_hours end,
      auto_step = case when p_item ? 'auto' then (p_item->'auto'->>'stepPct')::int else auto_step end,
      auto_max = case when p_item ? 'auto' then (p_item->'auto'->>'maxPct')::int else auto_max end,
      active = coalesce((p_item->>'active')::boolean, active)
    where id = v_id;
  else
    insert into merch_items (name, emoji, descr, price, stock, total, per_person, discount, auto_hours, auto_step, auto_max)
    values (left(coalesce(p_item->>'name', 'Приз'), 60), coalesce(p_item->>'emoji', '🎁'), coalesce(p_item->>'text', ''),
      greatest(1, coalesce((p_item->>'price')::int, 100)), greatest(0, coalesce((p_item->>'stock')::int, 1)), greatest(0, coalesce((p_item->>'stock')::int, 1)),
      greatest(1, coalesce((p_item->>'perPerson')::int, 1)), least(90, greatest(0, coalesce((p_item->>'discount')::int, 0))),
      coalesce((p_item->'auto'->>'afterHours')::real, 3), coalesce((p_item->'auto'->>'stepPct')::int, 10), coalesce((p_item->'auto'->>'maxPct')::int, 40));
  end if;
end $$;

/** Список «Название; количество; цена»: совпадение по названию обновляет количество и цену. */
create or replace function public.staff_merch_import(p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; ex text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    select id into ex from merch_items where lower(name) = lower(x->>'name') limit 1;
    if ex is not null then
      perform staff_merch_save(jsonb_build_object('id', ex, 'stock', x->'stock', 'price', x->'price', 'active', true));
    else
      perform staff_merch_save(jsonb_build_object('name', x->>'name', 'emoji', x->>'emoji', 'text', x->>'text', 'stock', x->'stock', 'price', x->'price'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.staff_orders() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(order_json(o) order by (o.status = 'reserved') desc, o.created_at desc) from merch_orders o), '[]'::jsonb);
end $$;

create or replace function public.staff_order_set(p_id text, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare o merch_orders;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_status not in ('issued', 'cancelled') then raise exception 'bad status'; end if;
  select * into o from merch_orders where id = p_id for update;
  if not found or o.status <> 'reserved' then raise exception 'Заказ уже закрыт'; end if;
  update merch_orders set status = p_status, done_by = auth.uid(), done_at = now() where id = p_id;
  if p_status = 'cancelled' then update merch_items set stock = stock + 1 where id = o.item_id; end if;
end $$;

create or replace function public.staff_orders_by_code(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid; sc record;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into sc from parse_scan(p_code);
  pid := player_by_code(sc.code);
  if pid is null then raise exception 'Код не подошёл: он живёт 30 секунд — попроси открыть QR заново'; end if;
  return jsonb_build_object('player', (select username from players where id = pid),
    'orders', coalesce((select jsonb_agg(order_json(o)) from merch_orders o where o.player_id = pid and o.status = 'reserved'), '[]'::jsonb));
end $$;

-- ---------- Блоки ----------
create or replace function public.lecture_json(l public.lectures, with_secret boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'title', l.title, 'points', l.points, 'openedAt', ms(l.opened_at), 'closesAt', ms(l.closes_at),
    'claims', (select count(*) from lecture_claims c where c.lecture_id = l.id),
    'mine', exists (select 1 from lecture_claims c where c.lecture_id = l.id and c.player_id = auth.uid()))
    || case when with_secret then jsonb_build_object('secret', l.secret) else '{}'::jsonb end
$$;
create or replace function public.lectures_open() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(lecture_json(l, false) order by l.opened_at desc), '[]'::jsonb) from lectures l where l.closes_at > now()
$$;
create or replace function public.staff_lecture_open(p_title text, p_points int, p_minutes int) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l lectures;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  insert into lectures (id, title, points, secret, closes_at, opened_by)
  values (substr(md5(random()::text), 1, 10), left(coalesce(nullif(btrim(p_title), ''), 'Блок'), 80), least(50, greatest(1, coalesce(p_points, 15))),
    encode(extensions.gen_random_bytes(16), 'hex'), now() + make_interval(mins => least(180, greatest(1, coalesce(p_minutes, 7)))), auth.uid())
  returning * into l;
  return lecture_json(l, true);
end $$;
create or replace function public.staff_lectures() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(lecture_json(l, true) order by l.opened_at desc) from (select * from lectures order by opened_at desc limit 40) l), '[]'::jsonb);
end $$;
create or replace function public.staff_lecture_close(p_id text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update lectures set closes_at = least(closes_at, now()) where id = p_id;
end $$;

-- ---------- Эфир ----------
create or replace function public.live_feed() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id::text, 'text', a.text, 'kind', a.kind, 'at', ms(a.created_at), 'until', case when a.until is null then null else ms(a.until) end,
    'author', p.username, 'source', 'staff') order by a.created_at desc), '[]'::jsonb)
  from (select * from announcements where until is null or until > now() order by created_at desc limit 20) a left join players p on p.id = a.author
$$;
create or replace function public.staff_announce(p_text text, p_kind text, p_minutes int) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  insert into announcements (text, kind, until, author) values (left(btrim(p_text), 500), case when p_kind in ('info', 'alert', 'win') then p_kind else 'info' end,
    case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end, auth.uid());
end $$;
create or replace function public.staff_announce_delete(p_id text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  delete from announcements where id = p_id::bigint;
end $$;

-- ---------- Список выезда в панели ----------
create or replace function public.staff_roster() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'fio', fio, 'faction', faction, 'group', grp, 'role', role,
    'bound', tg_id is not null or device_hash is not null, 'tg', tg_id is not null) order by faction, fio) from roster), '[]'::jsonb);
end $$;

/** Загрузка списка: [{fio, group, faction, role}]. Совпадение по ФИО обновляет строку (привязка и прогресс сохраняются). */
create or replace function public.staff_roster_import(p_rows jsonb) returns text language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; over text;
begin
  if not is_admin() then raise exception 'Загружать список могут только админы'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    if norm_fio(x->>'fio') = '' or (x->>'faction') is null then continue; end if;
    insert into roster (fio, fio_norm, grp, grp_norm, faction, role)
    values (btrim(x->>'fio'), norm_fio(x->>'fio'), coalesce(x->>'group', ''), norm_group(x->>'group'), x->>'faction', coalesce(x->>'role', 'participant'))
    on conflict (fio_norm) do update set fio = excluded.fio, grp = excluded.grp, grp_norm = excluded.grp_norm, faction = excluded.faction, role = excluded.role;
    update players set faction = x->>'faction', role = coalesce(x->>'role', 'participant'), is_staff = coalesce(x->>'role', 'participant') <> 'participant'
      where roster_id = (select id from roster where fio_norm = norm_fio(x->>'fio'));
    n := n + 1;
  end loop;
  select string_agg(faction, ', ') into over from (select faction from roster where role = 'participant' group by faction having count(*) > setting_int('pb_limit', 7)) z;
  return 'Загружено строк: ' || n || coalesce('. Внимание: больше ' || setting_int('pb_limit', 7) || ' человек в ' || over || ' — войдут только первые', '');
end $$;

create or replace function public.staff_roster_reset(p_id text) returns text language plpgsql security definer set search_path = public as $$
declare r roster;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update roster set tg_id = null, device_hash = null, bound_at = null where id = p_id::bigint returning * into r;
  if not found then raise exception 'Нет такой строки'; end if;
  return 'Вход сброшен: ' || r.fio || '. Прогресс сохранён — пусть войдёт заново по ФИО и группе.';
end $$;

create or replace function public.staff_set_setting(p_key text, p_value boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_key not in ('shop_open', 'require_group') then raise exception 'unknown setting'; end if;
  if p_key = 'require_group' and not is_admin() then raise exception 'Только админы'; end if;
  insert into settings (key, value) values (p_key, to_jsonb(p_value)) on conflict (key) do update set value = excluded.value;
end $$;

-- ---------- Мероприятия: в тесте — новое каждые 20 минут, организатор может запустить любое ----------
create or replace function public.current_event_slot(out event_id text, out start_at timestamptz, out end_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare h bigint; m int := setting_int('event_minutes_test', 20);
begin
  if test_mode() then
    h := floor(extract(epoch from now()) / (m * 60));
    select c.id into event_id from event_catalog c where c.n = h % 7;
    start_at := to_timestamp(h * m * 60);
    end_at := start_at + make_interval(mins => m);
  else
    select s.event_id, s.start_at, s.start_at + interval '60 minutes' into event_id, start_at, end_at
      from event_schedule s where now() >= s.start_at and now() < s.start_at + interval '60 minutes' limit 1;
  end if;
end $$;

create or replace function public.staff_start_event(p_id text) returns void language plpgsql security definer set search_path = public as $$
declare m int := setting_int('event_minutes_test', 20);
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not exists (select 1 from event_catalog where id = p_id) then raise exception 'Нет такого мероприятия'; end if;
  insert into events (key, event_id, start_at, end_at) values (p_id || '@' || ms(now()), p_id, now(), now() + make_interval(mins => m)) on conflict do nothing;
end $$;

-- ---------- Коды: пасхалки, тайники, блоки, знакомства ----------
drop function if exists public.redeem_code(text);
create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); v_raw text := upper(btrim(coalesce(p_code, ''))); eg egg_codes; ca cache_codes; other players; me players;
  g int := 0; msg text; n int; v_a uuid; v_b uuid; sc record; l lectures; slot bigint := floor(extract(epoch from now()) / 20); same int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  -- пасхалки
  select * into eg from egg_codes where egg_codes.code = v_raw;
  if found then
    if exists (select 1 from egg_redeems where player_id = uid and egg_redeems.code = eg.code) then msg := 'Эту пасхалку ты уже нашёл';
    else
      g := _grant_task(uid, eg.task, eg.rating);
      if g > 0 then insert into egg_redeems (player_id, code) values (uid, eg.code); msg := 'Пасхалка! +' || g || ' баллов';
      else msg := 'Лимит по этому заданию исчерпан'; end if;
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  -- тайники
  select * into ca from cache_codes where cache_codes.code = v_raw;
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
      msg := 'Тайник №' || ca.n || ': +' || g || ' баллов';
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  select * into sc from parse_scan(p_code);
  -- отметка на блоке
  if sc.kind <> 'person' then
    select * into l from lectures where closes_at > now() and (rot_code(secret, slot) = sc.code or rot_code(secret, slot - 1) = sc.code) limit 1;
    if found then
      if exists (select 1 from lecture_claims where lecture_id = l.id and player_id = uid) then
        return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'На блоке «' || l.title || '» ты уже отмечен', 'lecture', l.id);
      end if;
      insert into lecture_claims (lecture_id, player_id) values (l.id, uid);
      g := _grant_task(uid, 'lecture', l.points);
      -- бонус ПБ: 5+ человек одного ПБ на блоке → +10 влияния (один раз на блок)
      if me.role = 'participant' and not (me.faction = any (l.bonus_given)) then
        select count(*) into same from lecture_claims c join players p on p.id = c.player_id where c.lecture_id = l.id and p.faction = me.faction;
        if same >= 5 then
          update faction_world set influence = influence + 10 where faction = me.faction;
          update lectures set bonus_given = bonus_given || me.faction where id = l.id;
        end if;
      end if;
      return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', 'Отметка на блоке «' || l.title || '»: +' || g || ' баллов', 'lecture', l.id);
    end if;
    if sc.kind = 'lecture' then raise exception 'Код блока устарел или отметка закрыта. Сканируй QR с экрана ещё раз.'; end if;
  end if;
  -- знакомство по личному QR
  select * into other from players where id = player_by_code(sc.code);
  if found then
    if other.id = uid then raise exception 'Это твой собственный код'; end if;
    v_a := least(uid, other.id); v_b := greatest(uid, other.id);
    if exists (select 1 from meets where meets.a = v_a and meets.b = v_b) then raise exception 'С этим человеком вы уже знакомы'; end if;
    insert into meets (a, b, by_player) values (v_a, v_b, uid);
    g := _grant_task(uid, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end);
    if g = 0 then raise exception 'На сегодня лимит знакомств — 20'; end if;
    perform _grant_task(other.id, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end);
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', 'Знакомство с ' || other.username || ': +' || g);
  end if;
  raise exception 'Код не подошёл. Коды QR живут 20–30 секунд — попроси показать свежий.';
end $$;

create or replace function public.staff_checkin(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p players; g int; sc record;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into sc from parse_scan(p_code);
  select * into p from players where id = player_by_code(sc.code);
  if not found then return jsonb_build_object('message', 'Код не подошёл: он живёт 30 секунд — попроси открыть QR заново'); end if;
  g := _grant_task(p.id, 'checkin', 30, 'staff', auth.uid());
  return jsonb_build_object('message', case when g > 0 then p.username || ' отмечен на заезде: +30' else p.username || ' уже отмечен' end);
end $$;

create or replace function public.staff_find_players(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', username, 'faction', faction, 'rating', rating)) from (
    select * from players where roster_id is not null and username ilike '%' || p_q || '%' order by username limit 20) q), '[]'::jsonb);
end $$;

-- ---------- «Подготовка»: банк с ответами, открыт без входа ----------
create or replace function public.prep_bank() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'format', format, 'topic', topic, 'level', level, 'question', question,
    'options', options, 'source', source, 'explanation', explanation, 'answer', answer, 'accepted', to_jsonb(accepted),
    'correct', case format when 'yesno' then to_jsonb(correct_bool) when 'choice' then to_jsonb(correct_index) end)) order by id collate "C"), '[]'::jsonb)
  from question_pool()
$$;

-- ---------- Права ----------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.ping(), public.prep_bank(), public.get_config() to anon, authenticated;
grant execute on function
  public.me(), public.my_secret(),
  public.save_progress(jsonb, int, int),
  public.add_game_rating(text, int),
  public.get_questions(), public.check_answer(text, text), public.reveal_answer(text),
  public.claim_auto_task(text, int, text),
  public.leaderboard(), public.faction_stats(), public.leaderboard2(),
  public.get_clan(), public.contribute(text, int),
  public.get_world(), public.set_order(text, text, int), public.set_law_share(real), public.submit_event_score(text, int),
  public.submit_task(text, text, text), public.redeem_code(text),
  public.merch_list(), public.my_wallet(), public.my_orders(), public.merch_buy(text),
  public.lectures_open(), public.live_feed(),
  public.staff_submissions(), public.staff_review(bigint, boolean, int), public.staff_find_players(text),
  public.staff_grant(uuid, int, text, text), public.staff_checkin(text), public.staff_make_codes(int, text),
  public.staff_force_round(), public.staff_set_faction(uuid, text), public.staff_start_event(text),
  public.staff_merch_save(jsonb), public.staff_merch_import(jsonb), public.staff_orders(), public.staff_order_set(text, text), public.staff_orders_by_code(text),
  public.staff_lecture_open(text, int, int), public.staff_lectures(), public.staff_lecture_close(text),
  public.staff_announce(text, text, int), public.staff_announce_delete(text),
  public.staff_roster(), public.staff_roster_import(jsonb), public.staff_roster_reset(text), public.staff_set_setting(text, boolean)
to authenticated;
grant execute on function public.apply_referral(uuid, text), public.roster_login(text, text, text, bigint, text, text), public.roster_attach(bigint, uuid) to service_role;

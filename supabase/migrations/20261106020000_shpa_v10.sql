-- v10 (6 ноября, правки организаторов):
-- 1. «Начислить»: ровно введённая сумма (ошибка была в панели) и «Снять» — минус баллы, не ниже нуля.
-- 2. Баллы — только за образовалку и задания; мини-игры, кампания и стычки дают профкоины.
-- 3. Мерч: цена по остатку — «когда осталось ≤ N, цена P».
-- 4. Голосование «Работа со спонсорами»: за / против по командам, итог на экране.
-- 5. Отметки на блоках и задания «Отмечает ведущий» — у одного назначенного организатора.
-- 6. Захват профкома: организаторы — боссы, урон копится по профбюро.
-- Полная очистка таблицы в функциях — только с явным «where true» (защита safeupdate в Supabase).

-- ============ 1. Начислить и снять ============
insert into public.task_defs (id, amount, lim) values ('penalty', 0, '100000') on conflict (id) do nothing;

create or replace function public.staff_grant(p_player uuid, p_amount int, p_task text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g int; r int; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not can_checkin() then raise exception '%', _checkin_denied(); end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Укажи, сколько баллов'; end if;
  if p_amount < 0 then
    -- снять: не больше, чем есть, рейтинг не уходит в минус
    perform pg_advisory_xact_lock(hashtext(p_player::text));
    select rating into r from players where id = p_player for update;
    if not found then raise exception 'Участник не найден'; end if;
    g := -least(-greatest(p_amount, -500), greatest(r, 0));
    if g = 0 then raise exception 'У участника 0 баллов — снимать нечего'; end if;
    insert into rating_log (player_id, kind, source, amount, note, created_by) values (p_player, 'staff', 'penalty', g, note, auth.uid());
    update players set rating = rating + g, updated_at = now() where id = p_player returning rating into r;
    perform _notify(p_player, 'Организатор снял ' || (-g) || ' ' || _plural(-g, 'балл', 'балла', 'баллов') || coalesce(': ' || note, ''), 'bad');
    return jsonb_build_object('granted', g, 'rating', r);
  end if;
  if p_task = 'penalty' then raise exception 'Для начисления выбери задание'; end if;
  g := _grant_task(p_player, coalesce(p_task, 'bonus'), least(p_amount, 500), 'staff', auth.uid(), note);
  if g = 0 then raise exception 'Лимит этого задания у участника уже исчерпан'; end if;
  select rating into r from players where id = p_player;
  perform _notify(p_player, 'Организатор начислил +' || g || ' ' || _plural(g, 'балл', 'балла', 'баллов') || coalesce(': ' || note, ''), 'ok');
  return jsonb_build_object('granted', g, 'rating', r);
end $$;
revoke execute on function public.staff_grant(uuid, int, text, text) from public, anon;
grant execute on function public.staff_grant(uuid, int, text, text) to authenticated;

/** Русские окончания: 1 балл, 2 балла, 5 баллов. */
create or replace function public._plural(n int, one text, few text, many text) returns text language sql immutable as $$
  select case when abs(n) % 100 between 11 and 14 then many
              when abs(n) % 10 = 1 then one
              when abs(n) % 10 between 2 and 4 then few
              else many end
$$;

-- ============ 2. Игры — только профкоины ============
-- Мини-игры, кампания и стычки больше не дают баллов: профкоины начисляет само приложение (лимит — в нём).
-- Функцию оставляем, чтобы старые открытые вкладки не падали: она просто ничего не начисляет.
create or replace function public._grant_game(uid uuid, p_source text, p_value int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r int;
begin
  select rating into r from players where id = uid;
  return jsonb_build_object('granted', 0, 'rating', coalesce(r, 0), 'coins_only', true);
end $$;
revoke all on function public._grant_game(uuid, text, int) from public, anon, authenticated;

-- ============ 3. Мерч: цена по остатку ============
-- tiers: [{"left": 5, "price": 200}, {"left": 2, "price": 300}] — когда осталось ≤ left, базовая цена = price
-- (берётся условие с самым маленьким подходящим left). Ручная скидка и автоскидка считаются уже от неё.
alter table public.merch_items add column if not exists tiers jsonb not null default '[]'::jsonb;

create or replace function public.merch_base_price(it public.merch_items) returns int language sql stable as $$
  select coalesce((select (t->>'price')::int from jsonb_array_elements(coalesce(it.tiers, '[]'::jsonb)) t
                    where it.stock <= (t->>'left')::int and (t->>'price')::int > 0
                    order by (t->>'left')::int asc limit 1), it.price)
$$;

create or replace function public.merch_price(it public.merch_items) returns int language sql stable as $$
  select greatest(1, ceil(merch_base_price(it) * (1 - greatest(it.discount,
    case when coalesce(it.auto_hours, 0) > 0 and it.stock > 0
      then least(coalesce(it.auto_max, 0), greatest(0, floor(extract(epoch from now() - it.last_sale_at) / (it.auto_hours * 3600)))::int * coalesce(it.auto_step, 0))
      else 0 end) / 100.0)))::int
$$;

create or replace function public.merch_json(it public.merch_items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', it.id, 'name', it.name, 'emoji', it.emoji, 'text', it.descr, 'price', it.price, 'stock', it.stock, 'total', it.total,
    'perPerson', it.per_person, 'discount', it.discount, 'active', it.active, 'lastSaleAt', ms(it.last_sale_at),
    'tiers', coalesce(it.tiers, '[]'::jsonb),
    'auto', case when coalesce(it.auto_hours, 0) > 0 then jsonb_build_object('afterHours', it.auto_hours, 'stepPct', it.auto_step, 'maxPct', it.auto_max) end)
$$;

/** Условия цены от организатора: не больше 6, остаток ≥ 0, цена 1…100000, по убыванию остатка. */
create or replace function public._merch_tiers(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('left', l, 'price', pr) order by l desc), '[]'::jsonb) from (
    select l, pr from (
      select distinct on (l) l, pr from (
        select greatest(0, least(10000, (t->>'left')::int)) l, greatest(1, least(100000, (t->>'price')::int)) pr
        from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) t
        where (t->>'left') ~ '^\d+$' and (t->>'price') ~ '^\d+$'
      ) x order by l, pr
    ) d order by l desc limit 6
  ) y
$$;

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
      tiers = case when p_item ? 'tiers' then _merch_tiers(p_item->'tiers') else tiers end,
      active = coalesce((p_item->>'active')::boolean, active)
    where id = v_id;
  else
    insert into merch_items (name, emoji, descr, price, stock, total, per_person, discount, auto_hours, auto_step, auto_max, tiers)
    values (left(coalesce(p_item->>'name', 'Приз'), 60), coalesce(p_item->>'emoji', '🎁'), coalesce(p_item->>'text', ''),
      greatest(1, coalesce((p_item->>'price')::int, 100)), greatest(0, coalesce((p_item->>'stock')::int, 1)), greatest(0, coalesce((p_item->>'stock')::int, 1)),
      greatest(1, coalesce((p_item->>'perPerson')::int, 1)), least(90, greatest(0, coalesce((p_item->>'discount')::int, 0))),
      coalesce((p_item->'auto'->>'afterHours')::real, 3), coalesce((p_item->'auto'->>'stepPct')::int, 10), coalesce((p_item->'auto'->>'maxPct')::int, 40),
      _merch_tiers(p_item->'tiers'));
  end if;
end $$;

-- ============ 4. Голосование «Работа со спонсорами» ============
-- Одно голосование за раз. Команды — по умолчанию 10 профбюро. Каждый из списка выезда ставит каждой команде
-- «за» или «против» (передумать можно, пока открыто); за свою команду (своё ПБ) — нельзя. Итог = за − против.
create table if not exists public.vote_poll (
  id int primary key default 1 check (id = 1),
  round int not null default 1,
  title text not null default 'Работа со спонсорами',
  teams jsonb not null default '[]'::jsonb,       -- [{"id": "ire", "name": "ИРЭ", "faction": "ire"}]
  status text not null default 'idle' check (status in ('idle', 'open', 'closed')),
  current text,                                   -- команда на сцене (null — голосуем за все сразу)
  reveal boolean not null default false,          -- показать победителя на экране
  updated_at timestamptz not null default now()
);
insert into public.vote_poll (id) values (1) on conflict (id) do nothing;
create table if not exists public.vote_ballots (
  round int not null,
  team text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  v smallint not null check (v in (-1, 1)),
  at timestamptz not null default now(),
  primary key (round, team, player_id)
);
alter table public.vote_poll enable row level security;
alter table public.vote_ballots enable row level security;

/** Состояние голосования: команды со счётом, мои голоса. Видят все вошедшие (и экран в зале). */
create or replace function public.vote_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v vote_poll; uid uuid := auth.uid(); my jsonb; t jsonb; myf text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v from vote_poll where id = 1;
  select faction into myf from players where id = uid;
  select coalesce(jsonb_object_agg(team, b.v), '{}'::jsonb) into my from vote_ballots b where b.round = v.round and b.player_id = uid;
  select coalesce(jsonb_agg(x.j || jsonb_build_object(
      'za', (select count(*) from vote_ballots b where b.round = v.round and b.team = x.j->>'id' and b.v = 1),
      'protiv', (select count(*) from vote_ballots b where b.round = v.round and b.team = x.j->>'id' and b.v = -1)) order by x.n), '[]'::jsonb)
    into t from jsonb_array_elements(v.teams) with ordinality x(j, n);
  return jsonb_build_object('round', v.round, 'title', v.title, 'status', v.status, 'current', v.current, 'reveal', v.reveal,
    'teams', t, 'my', my, 'myFaction', myf,
    'voters', (select count(distinct player_id) from vote_ballots b where b.round = v.round),
    'at', ms(v.updated_at));
end $$;

create or replace function public.vote_cast(p_team text, p_v int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v vote_poll; uid uuid := auth.uid(); p players; tm jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  select * into v from vote_poll where id = 1;
  if v.status <> 'open' then raise exception 'Голосование сейчас закрыто'; end if;
  if v.current is not null and v.current <> p_team then raise exception 'Сейчас голосуем за другую команду'; end if;
  select j into tm from jsonb_array_elements(v.teams) j where j->>'id' = p_team;
  if tm is null then raise exception 'Нет такой команды'; end if;
  if nullif(tm->>'faction', '') is not null and tm->>'faction' = p.faction then raise exception 'За свою команду голосовать нельзя'; end if;
  if coalesce(p_v, 0) = 0 then
    delete from vote_ballots where round = v.round and team = p_team and player_id = uid;
  else
    insert into vote_ballots (round, team, player_id, v) values (v.round, p_team, uid, case when p_v > 0 then 1 else -1 end)
      on conflict (round, team, player_id) do update set v = excluded.v, at = now();
  end if;
  return vote_state();
end $$;

/** Организатор: название и команды (новое голосование — голоса обнуляются). */
create or replace function public.staff_vote_setup(p_title text, p_teams jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare t jsonb;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', left(x->>'id', 24), 'name', left(btrim(x->>'name'), 40),
      'faction', case when x->>'faction' in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee') then x->>'faction' end)), '[]'::jsonb)
    into t from (select x from jsonb_array_elements(case when jsonb_typeof(p_teams) = 'array' then p_teams else '[]'::jsonb end) x
                 where coalesce(btrim(x->>'name'), '') <> '' and coalesce(x->>'id', '') <> '' limit 30) q;
  if jsonb_array_length(t) < 2 then raise exception 'Нужно хотя бы две команды'; end if;
  update vote_poll set round = round + 1, title = left(coalesce(nullif(btrim(p_title), ''), 'Работа со спонсорами'), 60), teams = t,
    status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  delete from vote_ballots where round < (select round from vote_poll where id = 1) - 3;
  return vote_state();
end $$;

/** Организатор: open (p_team — команда на сцене или null — все сразу), close, reveal, hide, reset (обнулить голоса). */
create or replace function public.staff_vote_control(p_action text, p_team text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_action = 'open' then
    if p_team is not null and not exists (select 1 from vote_poll, jsonb_array_elements(teams) j where id = 1 and j->>'id' = p_team) then raise exception 'Нет такой команды'; end if;
    update vote_poll set status = 'open', current = p_team, reveal = false, updated_at = now() where id = 1;
  elsif p_action = 'close' then update vote_poll set status = 'closed', current = null, updated_at = now() where id = 1;
  elsif p_action = 'reveal' then update vote_poll set status = 'closed', current = null, reveal = true, updated_at = now() where id = 1;
  elsif p_action = 'hide' then update vote_poll set reveal = false, updated_at = now() where id = 1;
  elsif p_action = 'reset' then update vote_poll set round = round + 1, status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  else raise exception 'unknown action %', p_action; end if;
  return vote_state();
end $$;

revoke execute on function public.vote_state(), public.vote_cast(text, int), public.staff_vote_setup(text, jsonb), public.staff_vote_control(text, text) from public, anon;
grant execute on function public.vote_state(), public.vote_cast(text, int), public.staff_vote_setup(text, jsonb), public.staff_vote_control(text, text) to authenticated;

-- ============ 5. Отмечает один организатор ============
-- settings.checkin_host = id строки списка выезда. Если задан — QR-отметки на блоках и «своя активность»,
-- а также «Начислить / Снять» доступны только ему. «Я — скорость» и «Проверка» сдач — всем организаторам.
-- По умолчанию — единственный админ из списка (если админ один). Меняется в «Настройках» (только админы).
insert into public.settings (key, value)
  select 'checkin_host', to_jsonb(r.id) from public.roster r
  where r.role = 'admin' and (select count(*) from public.roster where role = 'admin') = 1
on conflict (key) do nothing;

create or replace function public.checkin_host() returns bigint language sql stable security definer set search_path = public as $$
  select nullif(setting_int('checkin_host', 0), 0)::bigint
$$;
/** «Имя Фамилия» из «Фамилия Имя Отчество». */
create or replace function public._roster_short(f text) returns text language sql immutable as $$
  select btrim(split_part(btrim(f), ' ', 2) || ' ' || split_part(btrim(f), ' ', 1))
$$;
create or replace function public.can_checkin() returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() and (checkin_host() is null or exists (select 1 from players p where p.id = auth.uid() and p.roster_id = checkin_host()))
$$;
create or replace function public._checkin_denied() returns text language sql stable security definer set search_path = public as $$
  select 'Отмечает и начисляет баллы только ' || coalesce((select _roster_short(fio) from roster where id = checkin_host()), 'назначенный организатор')
$$;

create or replace function public.get_config() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h bigint := checkin_host(); hn text;
begin
  -- имя отмечающего — только вошедшим, не анонимному ключу
  if h is not null and auth.uid() is not null then select _roster_short(fio) into hn from roster where id = h; end if;
  return jsonb_build_object('shopOpen', setting_bool('shop_open', false) or test_mode(), 'testMode', test_mode(), 'requireGroup', setting_bool('require_group', true),
    'checkinHost', case when hn is not null then jsonb_build_object('id', h, 'name', hn) end,
    'canCheckin', case when auth.uid() is null then false else can_checkin() end);
end $$;

/** Админ: кто отмечает (id строки списка выезда организатора) или null — все организаторы. */
create or replace function public.staff_set_checkin_host(p_roster bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только админы'; end if;
  if p_roster is null then delete from settings where key = 'checkin_host'; return get_config(); end if;
  if not exists (select 1 from roster where id = p_roster and role in ('staff', 'admin')) then raise exception 'Это не организатор из списка выезда'; end if;
  insert into settings (key, value) values ('checkin_host', to_jsonb(p_roster)) on conflict (key) do update set value = excluded.value;
  return get_config();
end $$;
revoke execute on function public.staff_set_checkin_host(bigint) from public, anon;
grant execute on function public.staff_set_checkin_host(bigint) to authenticated;
grant execute on function public.get_config() to anon, authenticated;

-- QR-отметка: блок и своя активность — только у отмечающего; «Я — скорость» — у всех организаторов
create or replace function public.staff_lecture_open(p_title text, p_points int, p_minutes int, p_kind text default 'lecture', p_max int default 0, p_rotating boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l lectures; k text := case when p_kind in ('lecture', 'speed', 'activity') then p_kind else 'lecture' end; rot boolean := coalesce(p_rotating, true);
  v_code text; i int := 0; v_title text := left(coalesce(nullif(btrim(p_title), ''), 'Блок'), 80);
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if k <> 'speed' and not can_checkin() then raise exception '%', _checkin_denied(); end if;
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

-- ============ 6. Захват профкома ============
-- Боссы — все организаторы из списка выезда (админы — в конце, последний — финальный босс с тройным запасом).
-- Каждое профбюро проходит цепочку само: урон его участников копится по текущему боссу. Без атак босс
-- восстанавливает 10% здоровья в час. Один штурм — раз в 20 минут (в тест-режиме — раз в 2), урон за штурм —
-- не больше 6 × сила отряда игрока на сервере. Кто победил последнего босса — захватил профком
-- (другое профбюро может перехватить, пройдя цепочку до конца).
create table if not exists public.raid_progress (
  faction text primary key check (faction in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee')),
  boss int not null default 0,          -- индекс текущего босса
  dmg bigint not null default 0,        -- урон по нему (до восстановления)
  last_hit timestamptz,
  done_at timestamptz                   -- когда прошло всю цепочку
);
create table if not exists public.raid_hits (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  faction text not null,
  boss int not null,
  dmg int not null,
  at timestamptz not null default now()
);
create index if not exists raid_hits_player on public.raid_hits (player_id, at desc);
create table if not exists public.raid_world (
  id int primary key default 1 check (id = 1),
  holder text,
  held_at timestamptz
);
insert into public.raid_world (id) values (1) on conflict (id) do nothing;
alter table public.raid_progress enable row level security;
alter table public.raid_hits enable row level security;
alter table public.raid_world enable row level security;
insert into public.settings (key, value) values ('raid_hp', '45000') on conflict (key) do nothing;

/** Боссы: организаторы по порядку списка, админы — последними. hp растёт к концу цепочки. */
create or replace function public._raid_bosses() returns table (i int, name text, title text, hp bigint) language sql stable security definer set search_path = public as $$
  with o as (
    select r.fio, r.position, r.role, row_number() over (order by (r.role = 'admin'), r.id) - 1 as n, count(*) over () as cnt
    from roster r where r.role in ('staff', 'admin')
  )
  select n::int, _roster_short(fio), coalesce(nullif(btrim(position), ''), case when role = 'admin' then 'Председатель' else 'Организатор' end),
    (setting_int('raid_hp', 45000) * (1 + 0.25 * n) * case when n = cnt - 1 then 2.5 else 1 end)::bigint
  from o order by n
$$;

/** Урон по текущему боссу с учётом восстановления: −10% здоровья босса за каждый час без атак. */
create or replace function public._raid_eff(rp raid_progress, hp bigint) returns bigint language sql stable as $$
  select greatest(0, rp.dmg - floor(hp * 0.10 * greatest(0, extract(epoch from now() - coalesce(rp.last_hit, now())) / 3600.0)))::bigint
$$;

create or replace function public.raid_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; rp raid_progress; bosses jsonb; nb int; cur_hp bigint; eff bigint; cd int; w raid_world;
  per int := case when test_mode() then 2 else 20 end; last timestamptz;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  select coalesce(jsonb_agg(jsonb_build_object('i', b.i, 'name', b.name, 'title', b.title, 'hp', b.hp) order by b.i), '[]'::jsonb), count(*) into bosses, nb from _raid_bosses() b;
  select * into w from raid_world where id = 1;
  if p.faction is not null and p.faction <> 'profkom' then
    select * into rp from raid_progress where faction = p.faction;
    if not found then rp := row(p.faction, 0, 0, null, null)::raid_progress; end if;
    select b.hp into cur_hp from _raid_bosses() b where b.i = rp.boss;
    eff := case when cur_hp is null then 0 else _raid_eff(rp, cur_hp) end;
    select max(at) into last from raid_hits where player_id = uid;
    cd := case when last is null then 0 else greatest(0, ceil(extract(epoch from (last + make_interval(mins => per)) - now())))::int end;
  end if;
  return jsonb_build_object('bosses', bosses, 'cooldownMin', per,
    'holder', case when w.holder is not null then jsonb_build_object('faction', w.holder, 'at', ms(w.held_at)) end,
    'my', case when rp.faction is not null then jsonb_build_object('faction', rp.faction, 'boss', rp.boss, 'dmg', eff, 'hp', coalesce(cur_hp, 0),
      'done', rp.boss >= nb, 'cooldownLeft', cd * 1000, 'power', greatest(p.power, 600)) end,
    'leaders', (select coalesce(jsonb_agg(jsonb_build_object('faction', x.faction, 'boss', x.boss, 'done', x.done_at is not null) order by x.boss desc, x.dmg desc), '[]'::jsonb)
                from raid_progress x where x.boss > 0 or x.dmg > 0));
end $$;

/** Удар по боссу своего профбюро. p_dmg — урон из боя в приложении, сервер ограничивает его силой отряда. */
create or replace function public.raid_hit(p_dmg int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; rp raid_progress; cur_hp bigint; eff bigint; nb int; dealt int; defeated boolean := false;
  captured boolean := false; per int := case when test_mode() then 2 else 20 end; bname text; fshort text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  if p.role <> 'participant' or p.faction is null or p.faction = 'profkom' then raise exception 'Организаторы — боссы, штурмуют участники'; end if;
  if exists (select 1 from raid_hits where player_id = uid and at > now() - make_interval(mins => per)) then
    raise exception 'Отряд отдыхает: штурм раз в % %', per, _plural(per, 'минуту', 'минуты', 'минут');
  end if;
  select count(*) into nb from _raid_bosses();
  if nb = 0 then raise exception 'Боссов пока нет — организаторы не в списке'; end if;
  perform pg_advisory_xact_lock(hashtext('raid:' || p.faction));
  insert into raid_progress (faction) values (p.faction) on conflict (faction) do nothing;
  select * into rp from raid_progress where faction = p.faction for update;
  if rp.boss >= nb then raise exception 'Твоё профбюро уже прошло всех боссов'; end if;
  select b.hp, b.name into cur_hp, bname from _raid_bosses() b where b.i = rp.boss;
  eff := _raid_eff(rp, cur_hp);
  dealt := greatest(0, least(coalesce(p_dmg, 0), greatest(p.power, 600) * 6, (cur_hp - eff)::int));
  insert into raid_hits (player_id, faction, boss, dmg) values (uid, p.faction, rp.boss, dealt);
  if eff + dealt >= cur_hp then
    defeated := true;
    update raid_progress set boss = boss + 1, dmg = 0, last_hit = now(), done_at = case when boss + 1 >= nb then now() else done_at end where faction = p.faction;
    fshort := (select case p.faction when 'inei' then 'ИнЭИ' when 'ire' then 'ИРЭ' when 'gpi' then 'ГПИ' when 'igvie' then 'ИГВИЭ' when 'ievt' then 'ИЭВТ'
      when 'iete' then 'ИЭТЭ' when 'enmi' then 'ЭнМИ' when 'itae' then 'ИТАЭ' when 'ivti' then 'ИВТИ' when 'iee' then 'ИЭЭ' else p.faction end);
    if rp.boss + 1 >= nb then
      captured := true;
      update raid_world set holder = p.faction, held_at = now() where id = 1;
      update faction_world set influence = influence + 300, trophies = array_append(trophies, 'Ключи от профкома') where faction = p.faction;
      insert into announcements (text, kind, until) values (fshort || ' захватили профком! Последний босс — ' || bname || ' — повержен.', 'win', now() + interval '3 hours');
    else
      insert into announcements (text, kind, until) values (fshort || ' победили босса «' || bname || '» на пути к профкому', 'info', now() + interval '20 minutes');
    end if;
  else
    update raid_progress set dmg = eff + dealt, last_hit = now() where faction = p.faction;
  end if;
  return jsonb_build_object('dealt', dealt, 'defeated', defeated, 'captured', captured, 'boss', bname) || jsonb_build_object('state', raid_state());
end $$;

/** Организатор: сложность (здоровье первого босса) и сброс штурма. */
create or replace function public.staff_raid_set(p_hp int) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  insert into settings (key, value) values ('raid_hp', to_jsonb(greatest(1000, least(1000000, coalesce(p_hp, 45000))))) on conflict (key) do update set value = excluded.value;
  return raid_state();
end $$;
create or replace function public.staff_raid_reset() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только админы'; end if;
  delete from raid_hits where true;
  delete from raid_progress where true;
  update raid_world set holder = null, held_at = null where id = 1;
  return raid_state();
end $$;
revoke execute on function public.raid_state(), public.raid_hit(int), public.staff_raid_set(int), public.staff_raid_reset() from public, anon;
grant execute on function public.raid_state(), public.raid_hit(int), public.staff_raid_set(int), public.staff_raid_reset() to authenticated;
revoke all on function public._raid_bosses() from public, anon, authenticated;

-- ============ Сброс «вообще всего» — ещё и голосование, и штурм профкома ============
create or replace function public._reset_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := _reset_progress();
  n := _reset_registrations();
  delete from vote_ballots where true;
  update vote_poll set round = round + 1, status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  delete from raid_hits where true;
  delete from raid_progress where true;
  update raid_world set holder = null, held_at = null where id = 1;
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

/** Сводка для журнала выкатки — только числа. */
create or replace function public._db_summary() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roster', (select count(*) from roster),
    'staff', (select count(*) from roster where role in ('staff', 'admin')),
    'admins', (select count(*) from roster where role = 'admin'),
    'checkin_host_set', checkin_host() is not null,
    'registered', (select count(*) from roster where tg_id is not null or device_hash is not null),
    'players_in_game', (select count(*) from players where roster_id is not null),
    'rating_sum', (select coalesce(sum(rating), 0) from players),
    'submissions', (select count(*) from submissions),
    'merch_orders', (select count(*) from merch_orders),
    'epoch', setting_int('progress_epoch', 0))
$$;
revoke all on function public._db_summary() from public, anon, authenticated;

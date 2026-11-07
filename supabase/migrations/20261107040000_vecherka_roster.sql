-- Вечерка, 7 ноября: свой список выезда, вход организаторов по коду, «Стать ведущим», подсказки ФИО и группы.
-- 1. Список вечерки — отдельная таблица bz_roster (профбюро, ФИО, группа), с игрой ШПА не связана. Первый раз
--    заполняется из списка игры, дальше ведущий загружает актуальную таблицу («Команды и люди» → «Список выезда»).
--    Сами ФИО в репозиторий не попадают.
-- 2. Организаторы входят по ФИО и коду организатора вечерки (регистр, кавычки и лишние пробелы не важны) и могут
--    «Стать ведущим». Код организатора игры ШПА для вечерки больше не подходит. Код хранится только отпечатком
--    (sha256), поменять его можно в «Настройках» ведущего. Все прежние входы ведущих сброшены.
-- 3. Подсказки при вводе: ФИО — по первым буквам слов (не меньше двух букв), группа — по первым знакам.

create table if not exists public.bz_roster (
  id serial primary key,
  fio text not null,
  fio_norm text not null unique,
  grp text not null default '',
  grp_norm text not null default '',
  team_code text,                    -- код профбюро (ire, gpi…); null — без команды
  created_at timestamptz not null default now()
);
alter table public.bz_roster enable row level security;
revoke all on public.bz_roster from anon, authenticated;

-- первый список — из списка выезда игры (только участники)
insert into public.bz_roster (fio, fio_norm, grp, grp_norm, team_code)
select r.fio, r.fio_norm, coalesce(r.grp, ''), coalesce(r.grp_norm, ''), nullif(r.faction, 'profkom')
from public.roster r where r.role = 'participant' and not exists (select 1 from public.bz_roster)
on conflict (fio_norm) do nothing;

-- входы вечерки теперь ссылаются на её собственный список; прежние входы по ФИО сбрасываются (до вечерки)
alter table public.bz_clients drop constraint if exists bz_clients_roster_id_fkey;
update public.bz_teams set captain = null, claimed_at = null where captain in (select id from public.bz_clients where roster_id is not null);
delete from public.bz_votes where true;
update public.bz_clients set roster_id = null, fio = null, grp = null, team_id = null, team_src = null where roster_id is not null or team_id is not null;
alter table public.bz_clients add constraint bz_clients_roster_id_fkey foreign key (roster_id) references public.bz_roster(id) on delete set null;
alter table public.bz_clients add column if not exists org boolean not null default false;
alter table public.bz_clients add column if not exists sugg_n int not null default 0;
alter table public.bz_clients add column if not exists sugg_at timestamptz;

/** Код: регистр, ё/е, латинские буквы-двойники, кавычки и знаки, лишние пробелы не важны. */
create or replace function public._bz_norm_code(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(
    translate(replace(upper(coalesce(p, '')), 'Ё', 'Е'), 'ABEKMHOPCTYX', 'АВЕКМНОРСТУХ'),
    '[^0-9A-ZА-Я]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- код организатора вечерки (только отпечаток); все прежние входы ведущих — недействительны
update public.bz_game set host_code_hash = '5f3f2cc41dc31f4a1bc1171bff49a3c56729508115566b745f5f5d59ad93782c' where id = 1;
delete from public.bz_hosts where true;

-- ───────────────────────── вход ─────────────────────────

create or replace function public._bz_issue(p_ident text, p_kind text, p_name text, p_username text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); cid bigint; nm2 text;
  nm text := left(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), 40);
begin
  if nm is null then nm := 'Без имени'; end if;
  insert into bz_clients (ident, kind, token_hash, name, username)
  values (p_ident, p_kind, _bz_hash(tok), nm, left(nullif(btrim(coalesce(p_username, '')), ''), 40))
  on conflict (ident) do update set token_hash = excluded.token_hash,
    name = case when bz_clients.roster_id is null and not bz_clients.org then excluded.name else bz_clients.name end,
    username = excluded.username, as_of_ms = null, last_seen_ms = null
  returning id, name into cid, nm2;
  return jsonb_build_object('ok', true, 'token', tok, 'id', cid, 'name', nm2);
end $$;

/** Ищет человека в списке вечерки: фамилия и имя в любом порядке, опечатка в длинных словах; отчество — чтобы различить
 *  тёзок; группа — цифры должны совпасть (у кого группа в списке не указана — не проверяется). */
create or replace function public._bz_roster_find(p_fio text, p_group text, p_any_group boolean default false) returns setof public.bz_roster
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t text[] := string_to_array(norm_fio(p_fio), ' '); g text := norm_group(p_group); r bz_roster; rt text[];
  ok boolean; i int; j int; ids int[] := '{}'; ids3 int[] := '{}';
begin
  if coalesce(array_length(t, 1), 0) < 2 then return; end if;
  for r in select * from bz_roster loop
    rt := string_to_array(r.fio_norm, ' ');
    ok := false;
    for i in 1 .. array_length(t, 1) loop
      for j in 1 .. array_length(t, 1) loop
        if i <> j and levenshtein(t[i], rt[1]) <= roster_tol(rt[1]) and levenshtein(t[j], coalesce(rt[2], '')) <= roster_tol(coalesce(rt[2], '')) then ok := true; end if;
      end loop;
    end loop;
    if not ok then continue; end if;
    if not p_any_group and r.grp_norm <> '' and (g = '' or regexp_replace(g, '\D', '', 'g') <> regexp_replace(r.grp_norm, '\D', '', 'g') or levenshtein(g, r.grp_norm) > 3) then continue; end if;
    ids := ids || r.id;
    if array_length(t, 1) >= 3 and coalesce(rt[3], '') <> ''
       and exists(select 1 from unnest(t) w where levenshtein(w, rt[3]) <= roster_tol(rt[3])) then ids3 := ids3 || r.id; end if;
  end loop;
  -- тёзки: если написали отчество и оно совпало — только они
  if coalesce(array_length(ids, 1), 0) > 1 and coalesce(array_length(ids3, 1), 0) >= 1 then ids := ids3; end if;
  return query select * from bz_roster where id = any(ids);
end $$;

/** Загрузка списка: rows = [[профбюро, ФИО, группа], …]. Профбюро — как в названии команды (ИРЭ, ГПИ…) или пусто. */
create or replace function public._bz_roster_load(p_rows jsonb, p_replace boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare x jsonb; v_fio text; v_fn text; v_grp text; v_tc text; seen text[] := '{}'; added int := 0; updated int := 0; removed int := 0; bad int := 0; rid int;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 400 then
    return jsonb_build_object('error', 'Нужно от 1 до 400 строк');
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_fio := left(btrim(regexp_replace(coalesce(x->>1, ''), '\s+', ' ', 'g')), 80);
    v_fn := norm_fio(v_fio);
    if coalesce(array_length(string_to_array(v_fn, ' '), 1), 0) < 2 then bad := bad + 1; continue; end if;
    v_grp := left(btrim(coalesce(x->>2, '')), 20);
    v_tc := _bz_code(x->>0);
    if v_fn = any(seen) then continue; end if;
    seen := seen || v_fn;
    update bz_roster set fio = v_fio, grp = v_grp, grp_norm = norm_group(v_grp), team_code = v_tc
      where fio_norm = v_fn returning id into rid;
    if rid is not null then updated := updated + 1;
    else
      insert into bz_roster (fio, fio_norm, grp, grp_norm, team_code) values (v_fio, v_fn, v_grp, norm_group(v_grp), v_tc);
      added := added + 1;
    end if;
    rid := null;
  end loop;
  if p_replace then
    delete from bz_votes v using bz_clients c, bz_roster r
      where c.id = v.client_id and r.id = c.roster_id and not (r.fio_norm = any(seen));
    with gone as (delete from bz_roster where not (fio_norm = any(seen)) returning id) select count(*) into removed from gone;
    update bz_clients set fio = null, grp = null, team_id = null, team_src = null where roster_id is null and team_src = 'roster';
  end if;
  -- вошедшим — актуальные группа и профбюро из списка
  update bz_clients c set fio = r.fio, grp = nullif(r.grp, ''), team_id = _bz_team_for(r.team_code)
    from bz_roster r where r.id = c.roster_id and c.team_src = 'roster';
  update bz_teams tm set captain = null, claimed_at = null
    where captain is not null and not exists(select 1 from bz_clients c where c.id = tm.captain and c.team_id = tm.id);
  return jsonb_build_object('loaded', jsonb_build_object('added', added, 'updated', updated, 'removed', removed, 'bad', bad,
    'total', (select count(*) from bz_roster)));
end $$;

/**
 * Вход. Участник — ФИО и группа из списка вечерки, профбюро — из списка, одно ФИО — один телефон.
 * Организатор — ФИО (как удобно) и код организатора вечерки. 8 ошибок за 15 минут — пауза.
 */
create or replace function public.bz_login(p_token text, p_fio text, p_group text, p_code text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  c bz_clients := _bz_client(p_token); r bz_roster; n int; k text; other bz_clients; tid int; parts text[]; g bz_game;
  staff boolean := coalesce(btrim(p_code), '') <> ''; ids int[]; nm text;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  k := 'bzl:' || c.id;
  delete from bz_attempts where at < now() - interval '15 minutes';
  if (select count(*) from bz_attempts where key = k) >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много попыток. Подожди 15 минут или подойди к ведущему.');
  end if;
  if coalesce(array_length(string_to_array(norm_fio(p_fio), ' '), 1), 0) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Напиши фамилию и имя');
  end if;
  if exists(select 1 from bz_votes where client_id = c.id) and (c.roster_id is not null or c.org) then
    return jsonb_build_object('ok', false, 'error', 'Ты уже проголосовал(а) — сменить вход может только ведущий.');
  end if;

  if staff then
    select * into g from bz_game where id = 1;
    if g.host_code_hash is null or _bz_hash(_bz_norm_code(p_code)) <> g.host_code_hash then
      insert into bz_attempts (key) values (k);
      return jsonb_build_object('ok', false, 'error', 'Неверный код организатора');
    end if;
    perform 1 from bz_game where id = 1 for update;
    nm := left(initcap(btrim(regexp_replace(p_fio, '\s+', ' ', 'g'))), 60);
    update bz_teams set captain = null, claimed_at = null where captain = c.id;
    update bz_clients set roster_id = null, org = true, fio = nm, grp = null, team_id = null, team_src = null, team_at = now(),
      name = left(nm, 40)
    where id = c.id;
    perform _bz_bump();
    return jsonb_build_object('ok', true) || _bz_view(false, c.id);
  end if;

  if coalesce(btrim(p_group), '') = '' and exists(select 1 from _bz_roster_find(p_fio, '', true) f where f.grp_norm <> '') then
    return jsonb_build_object('ok', false, 'error', 'Напиши группу — как в списке выезда, например ЭР-01-24');
  end if;
  select array_agg(f.id) into ids from _bz_roster_find(p_fio, p_group) f;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', 'Не нашли тебя в списке выезда. Проверь ФИО и группу. Если всё верно — подойди к ведущему.');
  end if;
  if n > 1 then return jsonb_build_object('ok', false, 'error', 'Нашли несколько похожих — напиши ФИО полностью, с отчеством.'); end if;
  select * into r from bz_roster where id = ids[1];

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

  tid := _bz_team_for(r.team_code);
  parts := string_to_array(r.fio, ' ');
  update bz_clients set roster_id = r.id, org = false, fio = r.fio, grp = nullif(r.grp, ''),
    name = left(coalesce(parts[2] || ' ', '') || parts[1], 40),
    team_id = tid, team_src = 'roster', team_at = now()
  where id = c.id;
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
  update bz_clients set roster_id = null, org = false, fio = null, grp = null, team_id = null, team_src = null, team_at = now() where id = c.id;
  perform _bz_bump();
  return jsonb_build_object('ok', true) || _bz_view(false, c.id);
end $$;

/**
 * Подсказки при вводе. p_kind = 'fio': ФИО из списка, где каждое написанное слово — начало одного из слов ФИО
 * (порядок любой, нужно хотя бы 2 буквы); 'grp': группы из списка, начинающиеся с написанного. Не больше 8.
 * Не больше 240 запросов за 10 минут с телефона.
 */
create or replace function public.bz_suggest(p_token text, p_kind text, p_q text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); t text[]; g text; res jsonb;
begin
  if c.id is null then return jsonb_build_object('code', 'auth'); end if;
  update bz_clients set sugg_n = case when sugg_at is null or sugg_at < now() - interval '10 minutes' then 1 else sugg_n + 1 end,
    sugg_at = case when sugg_at is null or sugg_at < now() - interval '10 minutes' then now() else sugg_at end
  where id = c.id returning sugg_n into c.sugg_n;
  if c.sugg_n > 240 then return jsonb_build_object('items', '[]'::jsonb); end if;
  if p_kind = 'fio' then
    t := array_remove(string_to_array(norm_fio(p_q), ' '), '');
    if coalesce(array_length(t, 1), 0) = 0 or length(array_to_string(t, '')) < 2 then return jsonb_build_object('items', '[]'::jsonb); end if;
    -- сначала те, у кого с написанного начинается фамилия
    select coalesce(jsonb_agg(x.fio order by x.o), '[]'::jsonb) into res from (
      select r.fio, row_number() over (order by split_part(r.fio_norm, ' ', 1) like t[1] || '%' desc, r.fio) as o from bz_roster r
      where (select bool_and(exists(select 1 from unnest(string_to_array(r.fio_norm, ' ')) as w(x) where w.x like q.p || '%')) from unnest(t) as q(p))
      order by o limit 8) x;
  elsif p_kind = 'grp' then
    g := norm_group(p_q);
    if g = '' then return jsonb_build_object('items', '[]'::jsonb); end if;
    select coalesce(jsonb_agg(x.grp order by x.grp), '[]'::jsonb) into res from (
      select min(r.grp) as grp from bz_roster r where r.grp_norm like g || '%' and r.grp <> '' group by r.grp_norm order by 1 limit 8) x;
  else
    return jsonb_build_object('error', 'bad kind');
  end if;
  return jsonb_build_object('items', res);
end $$;

-- ───────────────────────── ведущий ─────────────────────────

/** Вход ведущего по коду организатора вечерки (для экрана ведущего в браузере, …/knopka/?host). */
create or replace function public.bz_host_login(p_code text, p_key text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare k text := 'bzh:' || left(coalesce(p_key, ''), 64); code text := _bz_norm_code(p_code); g bz_game; tok text;
begin
  delete from bz_attempts where at < now() - interval '15 minutes';
  if (select count(*) from bz_attempts where key = k) >= 8 or (select count(*) from bz_attempts where key like 'bzh:%') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'Слишком много попыток — подожди 15 минут');
  end if;
  select * into g from bz_game where id = 1;
  if code = '' or g.host_code_hash is null or _bz_hash(code) <> g.host_code_hash then
    insert into bz_attempts (key) values (k);
    return jsonb_build_object('ok', false, 'error', 'Неверный код организатора');
  end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into bz_hosts (token_hash) values (_bz_hash(tok));
  delete from bz_hosts where created_at < now() - interval '3 days';
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

/** «Стать ведущим» — для организатора, который уже вошёл с кодом. */
create or replace function public.bz_host_enter(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); tok text;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  if not c.org then return jsonb_build_object('ok', false, 'error', 'Ведущим может стать только организатор — войди с кодом организатора'); end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into bz_hosts (token_hash) values (_bz_hash(tok));
  delete from bz_hosts where created_at < now() - interval '3 days';
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

-- ───────────────────────── состояние ─────────────────────────

create or replace function public._bz_view(p_host boolean, p_client bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms();
  g bz_game; r bz_rounds; st text; cl_ms double precision; cl_by text; my bz_clients;
  teams jsonb; rost jsonb := null; rj jsonb := null; me jsonb := null; hist jsonb := null; clips jsonb; vote jsonb; members jsonb := null;
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
      'in', my.roster_id is not null or my.org,
      'org', my.org,
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
    -- все, кто открыл кнопку: [id, имя, ФИО, команда, откуда команда, tg/web, на связи, проголосовал, группа, организатор]
    select coalesce(jsonb_agg(jsonb_build_array(m.id, m.name, m.fio, m.team_id, m.team_src, m.kind,
        m.last_seen_ms is not null and t - m.last_seen_ms < 10000,
        exists(select 1 from bz_votes v where v.client_id = m.id), m.grp, m.org) order by m.team_id nulls first, m.fio nulls first, m.name), '[]'::jsonb)
    into members from bz_clients m;
    rost := jsonb_build_object('total', (select count(*) from bz_roster),
      'in', (select count(*) from bz_clients where roster_id is not null),
      'no_team', (select count(*) from bz_roster br where _bz_team_for(br.team_code) is null));
  end if;

  return jsonb_build_object('v', g.v, 'game', jsonb_build_object('title', g.title, 'locked', g.teams_locked,
      'countdown_ms', g.countdown_ms, 'limit_ms', g.limit_ms, 'lockout_ms', g.lockout_ms, 'pts_ok', g.pts_ok,
      'pts_bad', g.pts_bad, 'auto_close', g.auto_close, 'own_code', g.host_code_hash is not null),
    'teams', teams, 'round', rj, 'clips', clips, 'vote', vote)
    || case when me is not null then jsonb_build_object('me', me) else '{}'::jsonb end
    || case when p_host then jsonb_build_object('history', hist, 'members', members, 'roster', rost) else '{}'::jsonb end;
end $$;

-- ───────────────────────── кнопка ─────────────────────────

/** Ошибка, если человек не может жать за свою команду (null — может). */
create or replace function public._bz_need_team(c bz_clients) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if c.org then return 'Организаторы не жмут кнопку за команды'; end if;
  if c.roster_id is null and c.team_id is null then return 'Сначала войди по ФИО и группе'; end if;
  if c.team_id is null then return 'Твоего профбюро нет среди команд — подойди к ведущему'; end if;
  return null;
end $$;

-- ───────────────────────── голосование ─────────────────────────

create or replace function public.bz_vote(p_token text, p_clip int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c bz_clients := _bz_client(p_token); g bz_game; k bz_clips; tname text;
begin
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;
  select * into c from bz_clients where id = c.id;
  if g.vote_status <> 'open' then return jsonb_build_object('ok', false, 'error', 'Голосование сейчас закрыто'); end if;
  if c.roster_id is null and not c.org then return jsonb_build_object('ok', false, 'error', 'Сначала войди по ФИО и группе — голосуют участники выезда'); end if;
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

-- ───────────────────────── ведущий: действия ─────────────────────────

create or replace function public.bz_host(p_host text, p_act text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms(); g bz_game; rid int; n int; tid int; cid bigint; vv text; names text[]; i int; nm text;
  cd int; code text; a jsonb := coalesce(p_arg, '{}'::jsonb); it jsonb; r jsonb;
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
    update bz_clients c set team_id = _bz_team_for(r.team_code) from bz_roster r where c.team_src = 'roster' and r.id = c.roster_id;
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
    if code = '' then return jsonb_build_object('error', 'Без кода организатора войти будет нельзя — напишите новый код');
    elsif length(code) < 6 then return jsonb_build_object('error', 'Код — минимум 6 символов');
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
    update bz_clients set roster_id = null, org = false, fio = null, grp = null, team_id = null, team_src = null, team_at = now() where id = cid;
    if not found then return jsonb_build_object('error', 'Нет такого человека'); end if;

  elsif p_act = 'roster' then
    -- список выезда для вечерки: rows = [[профбюро, ФИО, группа], …]; replace — убрать тех, кого нет в списке
    r := _bz_roster_load(a->'rows', coalesce((a->>'replace')::boolean, false));
    if r ? 'error' then return r; end if;
    perform _bz_bump();
    return _bz_view(true, null) || r || jsonb_build_object('t', bz_ms());

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

revoke all on function public._bz_roster_find(text, text, boolean), public._bz_roster_load(jsonb, boolean), public._bz_issue(text, text, text, text),
  public._bz_view(boolean, bigint), public._bz_need_team(public.bz_clients) from public, anon, authenticated;
grant execute on function public.bz_login(text, text, text, text), public.bz_logout(text), public.bz_suggest(text, text, text),
  public.bz_host_login(text, text), public.bz_host_enter(text), public.bz_vote(text, int), public.bz_host(text, text, jsonb)
  to anon, authenticated;

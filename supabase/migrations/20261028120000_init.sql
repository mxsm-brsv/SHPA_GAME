-- Игра ШПА МЭИ: схема базы. Все изменения игроков идут через функции ниже (security definer),
-- прямой записи в таблицы у клиента нет.

create extension if not exists fuzzystrmatch with schema extensions;

-- ---------- Таблицы ----------
create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  tg_id bigint unique,
  login_code text unique,
  username text not null default 'Активист',
  faction text check (faction in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee','profkom')),
  is_staff boolean not null default false,
  rating int not null default 0,
  power int not null default 0,
  stage int not null default 1,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rating_log (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('game','task','staff')),
  source text not null,
  amount int not null,
  day date not null default (now() at time zone 'Europe/Moscow')::date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists rating_log_player_day on public.rating_log (player_id, day);

create table if not exists public.questions (
  id text primary key,
  format text not null check (format in ('yesno','choice','input')),
  topic text not null,
  level int not null default 1,
  question text not null,
  options jsonb,
  correct_bool boolean,
  correct_index int,
  answer text,
  accepted text[],
  explanation text not null default '',
  source text not null default '',
  approved boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.answers (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  correct boolean not null,
  day date not null default (now() at time zone 'Europe/Moscow')::date,
  created_at timestamptz not null default now()
);
create index if not exists answers_player_day on public.answers (player_id, day);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values
  ('only_approved_questions', 'false'),
  ('game_rating_cap', '100'),
  ('minigame_cap', '30'),
  ('freeze_at', '"2026-11-08T11:50:00+03:00"')
on conflict (key) do nothing;

-- Личные коды для входа без Telegram (выдают на регистрации)
create table if not exists public.login_codes (
  code text primary key,
  note text,
  used_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.rating_log enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.settings enable row level security;
alter table public.login_codes enable row level security;

drop policy if exists players_own on public.players;
create policy players_own on public.players for select to authenticated using (id = auth.uid());

-- ---------- Вспомогательные ----------
create or replace function public.msk_day() returns date language sql stable as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

create or replace function public.setting_int(k text, dflt int) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from settings where key = k), dflt)
$$;

create or replace function public.is_frozen() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(now() >= (select (value #>> '{}')::timestamptz from settings where key = 'freeze_at'), false)
$$;

create or replace function public.norm(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(replace(lower(coalesce(t, '')), 'ё', 'е'), '[«»"''.,!?;:()\-–—%№]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------- Сохранение прогресса ----------
create or replace function public.save_progress(p_state jsonb, p_username text, p_faction text, p_power int, p_stage int)
returns void language plpgsql security definer set search_path = public as $$
declare
  nick text := left(btrim(coalesce(p_username, '')), 24);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if octet_length(p_state::text) > 200000 then raise exception 'state too large'; end if;
  update players set
    state = p_state,
    username = case when length(nick) >= 2 then nick else username end,
    -- профбюро выбирается один раз; сменить может только организатор
    faction = coalesce(faction, case when p_faction in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee') then p_faction end),
    power = greatest(0, least(coalesce(p_power, 0), 10000000)),
    stage = greatest(1, least(coalesce(p_stage, 1), 60)),
    updated_at = now()
  where id = auth.uid();
end $$;

-- ---------- Рейтинг от игры (лимиты) ----------
create or replace function public.add_game_rating(p_source text, p_value int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d date := msk_day();
  cap_src int := setting_int('minigame_cap', 30);
  cap_total int := setting_int('game_rating_cap', 100);
  have_src int; have_total int; wanted int; g int; r int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_source not in ('fever','ring','campaign','runner','stamp','wordle','bus','blocks','merge','crossword','categories','skirmish') then
    raise exception 'unknown source';
  end if;
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

-- ---------- Вопросы ----------
create or replace function public.question_pool() returns setof public.questions
language sql stable security definer set search_path = public as $$
  select * from questions
  where active and (approved or not coalesce((select (value #>> '{}')::boolean from settings where key = 'only_approved_questions'), false))
$$;

create or replace function public.get_questions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'format', format, 'topic', topic, 'level', level, 'question', question,
    'options', options, 'source', source) order by id collate "C"), '[]'::jsonb)
  from question_pool()
$$;

create or replace function public.right_answer(q public.questions) returns text language sql immutable as $$
  select case q.format
    when 'yesno' then case when q.correct_bool then 'Да' else 'Нет' end
    when 'choice' then q.options ->> q.correct_index
    else q.answer end
$$;

create or replace function public.check_answer(p_id text, p_answer text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  q questions;
  ok boolean := false;
  g text := norm(p_answer);
  a text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into q from questions where id = p_id and active;
  if not found then raise exception 'no question'; end if;
  if q.format = 'yesno' then
    ok := p_answer = case when q.correct_bool then 'true' else 'false' end;
  elsif q.format = 'choice' then
    ok := p_answer = q.correct_index::text;
  else
    foreach a in array (array[q.answer] || coalesce(q.accepted, '{}'::text[])) loop
      a := norm(a);
      if length(g) > 0 and (a = g or (length(a) > 5 and length(g) >= length(a) - 1 and extensions.levenshtein(a, g) <= 1)) then
        ok := true; exit;
      end if;
    end loop;
  end if;
  insert into answers (player_id, question_id, correct) values (auth.uid(), q.id, ok);
  return jsonb_build_object('correct', ok, 'right', right_answer(q), 'explanation', q.explanation);
end $$;

create or replace function public.reveal_answer(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('right', right_answer(q), 'explanation', q.explanation)
  from questions q where q.id = p_id and q.active and auth.uid() is not null
$$;

-- Вопрос «Дело дня»: тот же алгоритм, что в клиенте (сортировка по id, номер дня по Москве)
create or replace function public.case_of_day_id() returns text
language sql stable security definer set search_path = public as $$
  with p as (select id, row_number() over (order by id collate "C") - 1 as rn, count(*) over () as n from question_pool())
  select id from p where rn = (floor((extract(epoch from now()) + 10800) / 86400)::bigint % n)
$$;

-- ---------- Автозадания ----------
create or replace function public.claim_auto_task(p_task text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d date := msk_day();
  amount int;
  r int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if is_frozen() then
    select rating into r from players where id = uid;
    return jsonb_build_object('granted', 0, 'rating', r, 'frozen', true);
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if exists (select 1 from rating_log where player_id = uid and day = d and kind = 'task' and source = p_task) then
    select rating into r from players where id = uid;
    return jsonb_build_object('granted', 0, 'rating', r);
  end if;
  if p_task = 'daily_login' then
    amount := 10;
  elsif p_task = 'case_day' then
    if not exists (select 1 from answers where player_id = uid and day = d and correct and question_id = case_of_day_id()) then
      raise exception 'case not solved';
    end if;
    -- засчитывается только первая попытка дня
    if (select count(*) from answers where player_id = uid and day = d and question_id = case_of_day_id()) > 1 then
      select rating into r from players where id = uid;
      return jsonb_build_object('granted', 0, 'rating', r);
    end if;
    amount := 20;
  else
    raise exception 'unknown task';
  end if;
  insert into rating_log (player_id, kind, source, amount) values (uid, 'task', p_task, amount);
  update players set rating = rating + amount, updated_at = now() where id = uid returning rating into r;
  return jsonb_build_object('granted', amount, 'rating', r);
end $$;

-- ---------- Рейтинги ----------
create or replace function public.leaderboard()
returns table (name text, faction text, rating int, power int, me boolean)
language sql stable security definer set search_path = public as $$
  (select username, faction, rating, power, id = auth.uid() from players
    where not is_staff and faction is not null order by rating desc, updated_at asc limit 100)
  union
  (select username, faction, rating, power, true from players where id = auth.uid())
  order by 3 desc
$$;

create or replace function public.faction_stats()
returns table (faction text, players bigint, rating bigint)
language sql stable security definer set search_path = public as $$
  select f.faction, count(p.id), coalesce(sum(p.rating), 0)
  from unnest(array['inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee']) as f(faction)
  left join players p on p.faction = f.faction and not p.is_staff
  group by f.faction
  order by 3 desc
$$;

-- ---------- Для организаторов ----------
create or replace function public.staff_grant(p_player uuid, p_amount int, p_task text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r int;
begin
  if not exists (select 1 from players where id = auth.uid() and is_staff) then raise exception 'staff only'; end if;
  insert into rating_log (player_id, kind, source, amount, note, created_by) values (p_player, 'staff', p_task, p_amount, p_note, auth.uid());
  update players set rating = rating + p_amount, updated_at = now() where id = p_player returning rating into r;
  return jsonb_build_object('rating', r);
end $$;

create or replace function public.staff_set_faction(p_player uuid, p_faction text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from players where id = auth.uid() and is_staff) then raise exception 'staff only'; end if;
  update players set faction = p_faction, state = jsonb_set(state, '{faction}', to_jsonb(p_faction)) where id = p_player;
end $$;

-- Пинг для GitHub Actions, чтобы бесплатный проект не засыпал
create or replace function public.ping() returns int language sql stable as $$ select count(*)::int from public.settings $$;

-- ---------- Права ----------
-- сначала забираем всё (включая служебные question_pool, right_answer и др.), потом выдаём нужное
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.save_progress(jsonb, text, text, int, int),
  public.add_game_rating(text, int),
  public.get_questions(),
  public.check_answer(text, text),
  public.reveal_answer(text),
  public.claim_auto_task(text),
  public.leaderboard(),
  public.faction_stats(),
  public.staff_grant(uuid, int, text, text),
  public.staff_set_faction(uuid, text)
to authenticated;

-- v15: кодовые слова (пасхалки) — 10 слов организаторов и добавление новых прямо во время выезда.
-- Слова из этой миграции лежат только отпечатками (sha256 от «shpa-word:» + слово без пробелов и знаков), репозиторий открытый.
-- Слово, добавленное в панели организатора, хранится в базе текстом (база закрыта), чтобы его было видно в списке.
-- Ввод прощает регистр, пробелы, знаки, «ё» и латинские буквы-двойники: «Сдвинь гору!» = «сдвинь  гору» = «СДВИНЬГОРУ».
-- Старые тестовые пасхалки ЭНЕРГИЯ, МОЛНИЯ, ЗОЛОТО удаляются.

create table if not exists public.code_words (
  hash text primary key,
  word text,
  hint text not null,
  task text not null default 'egg' check (task in ('egg', 'egg_gold')),
  points int not null check (points between 1 and 100),
  max_claims int check (max_claims is null or max_claims > 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.code_word_claims (
  hash text not null references public.code_words(hash) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (hash, player_id)
);
alter table public.code_words enable row level security;
alter table public.code_word_claims enable row level security;

insert into public.code_words (hash, hint, points) values
  ('b4d3852f3b03439821c4bed96340189ce0d3e8b17e4b67afa931a35cf0ecf55c', 'Слово №1 из списка организаторов', 15),
  ('260e33ba372a42cb80b9324718ba2f0c75f44eab597fb12a43367ed6088a52d7', 'Слово №2 из списка организаторов', 15),
  ('0c76fdfd77806acc783423bf19ab557b481f5a6ee3864d4c4916721520a75fa3', 'Слово №3 из списка организаторов', 15),
  ('76a7d6b69edfaac5d61a8fa0b3a5a69dc29cf4a6222dd80417d711f92e3e42dd', 'Слово №4 из списка организаторов', 15),
  ('21f2f1da0ccc5a16b869282fefe07f22743dee7fd7ed192055eac3715a967c24', 'Слово №5 из списка организаторов', 15),
  ('0e8a3d7aeaaa4cd34ec6c1882ccb633efbc375473ed15e168009fc100bcbe127', 'Слово №6 из списка организаторов', 15),
  ('7281c2af7be157f27e5aca060ae1573c5265587f08035fe9dd1560b9608495d5', 'Слово №7 из списка организаторов', 15),
  ('f3ffa353848d471e8f7a77798435d724bae65e11e2c2d7a1cf2a7049cee0a3aa', 'Слово №8 из списка организаторов', 15),
  ('3c2fffa23de46375253350e52a1e23a592ce9b3095069f040d264ca94a01ee3c', 'Слово №9 из списка организаторов', 15),
  ('6b6216011cfa02b1235e0505255ad5f9eee4ae0bcdf3f76b6ad99aacd6ff59ad', 'Слово №10 из списка организаторов', 15)
on conflict (hash) do nothing;

delete from public.egg_codes where note = 'тест';
-- пасхалок стало больше: лимит на человека 20 → 50
update public.task_defs set lim = '50' where id = 'egg';

/** Слово → вид для отпечатка: заглавные, ё → е, латиница-двойники → кириллица, только буквы и цифры. */
create or replace function public._word_norm(p text) returns text language sql immutable as $$
  select regexp_replace(translate(upper(translate(coalesce(p, ''), 'ёЁ', 'еЕ')), 'ABEKMHOPCTXY', 'АВЕКМНОРСТХУ'), '[^А-ЯA-Z0-9]', '', 'g')
$$;
create or replace function public._word_hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to('shpa-word:' || _word_norm(p), 'UTF8')), 'hex')
$$;
revoke all on function public._word_norm(text), public._word_hash(text) from public, anon, authenticated;

/** Ввод кодового слова: null — такого слова нет (дальше проверяются другие коды). */
create or replace function public._code_word_redeem(uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cw code_words; me players; n int; g int;
begin
  if length(_word_norm(p_code)) < 2 then return null; end if;
  select * into cw from code_words where hash = _word_hash(p_code) for update;
  if not found then return null; end if;
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  select count(*) into n from code_word_claims where hash = cw.hash;
  if me.is_staff then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Слово верное: +' || cw.points || case when cw.task = 'egg_gold' then ' (золотая пасхалка)' else '' end
      || ', ввели ' || n || case when cw.max_claims is not null then ' из ' || cw.max_claims else '' end
      || case when not cw.active then ', сейчас выключено' when cw.expires_at < now() then ', время вышло' else '' end
      || '. Организаторам баллы не начисляются');
  end if;
  if exists (select 1 from code_word_claims where hash = cw.hash and player_id = uid) then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Это слово ты уже вводил');
  end if;
  if not cw.active then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Это слово больше не принимается');
  end if;
  if cw.expires_at is not null and cw.expires_at < now() then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Время на это слово вышло');
  end if;
  if cw.max_claims is not null and n >= cw.max_claims then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Опоздал: слово уже ввели первые ' || cw.max_claims);
  end if;
  g := _grant_task(uid, cw.task, cw.points, 'task', null, 'кодовое слово');
  if g = 0 then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message',
      case when cw.task = 'egg_gold' then 'Золотая пасхалка сегодня уже засчитана' else 'Лимит пасхалок исчерпан' end);
  end if;
  insert into code_word_claims (hash, player_id) values (cw.hash, uid);
  return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message',
    case when cw.task = 'egg_gold' then 'Золотая пасхалка! +' else 'Кодовое слово! +' end || g || ' баллов'
    || case when cw.max_claims is not null then ' · ты ' || (n + 1) || '-й из ' || cw.max_claims else '' end);
end $$;
revoke all on function public._code_word_redeem(uuid, text) from public, anon, authenticated;

-- redeem_code: печатные QR → кодовые слова → прежняя проверка (отметки, знакомства, старые коды)
create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); me players; v text := _print_norm(p_code); pc print_codes; g int := 0; n int; msg text; w jsonb;
  link boolean := coalesce(p_code, '') ~ 'startapp=t_';
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if length(v) between 8 and 16 then
    select * into pc from print_codes where hash = encode(sha256(convert_to('shpa:' || v, 'UTF8')), 'hex') for update;
  end if;
  if pc.hash is null then
    if link then raise exception 'QR не распознан — такого кода в игре нет'; end if;
    w := _code_word_redeem(uid, p_code);
    if w is not null then return w; end if;
    -- русские буквы, которых нет в кодах QR, — это было кодовое слово
    if coalesce(p_code, '') ~ '[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯбгдёжзийлпфцчшщъыьэюя]' and coalesce(p_code, '') !~ 'startapp='
       and not exists (select 1 from egg_codes where code = upper(btrim(p_code))) then
      raise exception 'Такого кодового слова нет — проверь написание';
    end if;
    -- 10 латинских знаков — похоже на код с распечатки: подсказка понятнее, чем «QR живёт 20 секунд»
    if length(v) = 10 and coalesce(p_code, '') !~ '[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯбгдёжзийлпфцчшщъыьэюя]' then
      raise exception 'Код не подошёл — проверь 10 знаков под QR (буквы O и I в кодах не бывает)';
    end if;
    return _redeem_code_base(p_code);
  end if;
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  -- организатор проверяет распечатку: ничего не начисляется и не расходуется
  if me.is_staff then
    select count(*) into n from print_claims where hash = pc.hash;
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Код верный: ' || pc.title
      || case when pc.kind = 'speed' then ' (работает ' || to_char(pc.day, 'DD.MM') || ', нашли ' || n || ' из ' || pc.max_claims || ')'
              when pc.kind = 'cache_gold' then case when n > 0 then ' — уже найден' else ' — ещё не найден' end
              else ' — нашли ' || n end
      || '. Организаторам баллы не начисляются');
  end if;
  if exists (select 1 from print_claims where hash = pc.hash and player_id = uid) then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message',
      case pc.kind when 'cache' then 'Тайник №' || pc.n || ' уже найден' when 'speed' then 'Этот QR ты уже нашёл' else 'Золотой тайник уже твой' end);
  end if;
  if pc.kind = 'cache' then
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'caches', pc.points);
    select count(*) into n from print_claims c join print_codes p on p.hash = c.hash where c.player_id = uid and p.kind = 'cache';
    if n = 10 then g := g + _grant_task(uid, 'bonus', 50, 'task', null, 'все 10 тайников'); end if;
    msg := 'Тайник №' || pc.n || ': +' || g || ' баллов · найдено ' || n || ' из 10' || case when n = 10 then '. Все тайники!' else '' end;
  elsif pc.kind = 'cache_gold' then
    if exists (select 1 from print_claims where hash = pc.hash) then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Золотой тайник уже нашли до тебя');
    end if;
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'cache_gold', pc.points);
    msg := 'ЗОЛОТОЙ ТАЙНИК! +' || g || ' баллов';
  else
    if pc.day is not null and today <> pc.day then
      raise exception 'Этот QR «Я — скорость» работает только %', to_char(pc.day, 'DD.MM');
    end if;
    if (select count(*) from print_claims where hash = pc.hash) >= pc.max_claims then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Опоздал: баллы уже забрали первые ' || pc.max_claims);
    end if;
    if _task_left(uid, 'speed_qr') <= 0 then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', '«Я — скорость» сегодня уже засчитано');
    end if;
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'speed_qr', pc.points);
    select count(*) into n from print_claims where hash = pc.hash;
    msg := '«Я — скорость»: ты ' || n || '-й! +' || g || ' баллов';
  end if;
  return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
end $$;
revoke execute on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

-- ---------- Панель организатора: кодовые слова ----------
create or replace function public.staff_words() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', w.hash, 'text', coalesce(w.word, w.hint), 'hidden', w.word is null, 'points', w.points, 'gold', w.task = 'egg_gold',
      'max', w.max_claims, 'expires', case when w.expires_at is null then null else (extract(epoch from w.expires_at) * 1000)::bigint end,
      'active', w.active, 'found', (select count(*) from code_word_claims c where c.hash = w.hash),
      'by', (select _roster_short(r.fio) from players p join roster r on r.id = p.roster_id where p.id = w.created_by),
      'created', (extract(epoch from w.created_at) * 1000)::bigint)
    order by w.word is null, w.created_at desc) from code_words w), '[]'::jsonb);
end $$;

create or replace function public.staff_word_add(p_word text, p_points int, p_max int default null, p_minutes int default null, p_gold boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_word, ''));
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if length(_word_norm(v)) < 2 then raise exception 'Слово слишком короткое'; end if;
  if length(v) > 60 then raise exception 'Слово длиннее 60 знаков'; end if;
  if coalesce(p_points, 0) not between 1 and 100 then raise exception 'Баллы — от 1 до 100'; end if;
  if exists (select 1 from code_words where hash = _word_hash(v)) then raise exception 'Такое слово уже есть'; end if;
  insert into code_words (hash, word, hint, task, points, max_claims, expires_at, created_by)
  values (_word_hash(v), v, v, case when p_gold then 'egg_gold' else 'egg' end, p_points,
    case when coalesce(p_max, 0) > 0 then p_max end,
    case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end, auth.uid());
  return staff_words();
end $$;

create or replace function public.staff_word_set(p_id text, p_active boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update code_words set active = p_active where hash = p_id;
  return staff_words();
end $$;

create or replace function public.staff_word_delete(p_id text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  delete from code_words where hash = p_id;
  return staff_words();
end $$;
revoke all on function public.staff_words(), public.staff_word_add(text, int, int, int, boolean), public.staff_word_set(text, boolean), public.staff_word_delete(text) from public, anon;
grant execute on function public.staff_words(), public.staff_word_add(text, int, int, int, boolean), public.staff_word_set(text, boolean), public.staff_word_delete(text) to authenticated;

-- Полный сброс чистит и введённые слова (сами слова остаются)
create or replace function public._reset_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := _reset_progress();
  n := _reset_registrations();
  delete from vote_ballots where true;
  delete from vote_members where true;
  update vote_poll set round = round + 1, status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  delete from raid_hits where true;
  delete from raid_progress where true;
  update raid_world set holder = null, held_at = null where id = 1;
  delete from settings where key = 'casino_reveal';
  delete from law_duels where true;
  delete from print_claims where true;
  delete from code_word_claims where true;
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
    'print_codes', (select count(*) from print_codes),
    'print_claims', (select count(*) from print_claims),
    'old_caches', (select count(*) from cache_codes),
    'code_words', (select count(*) from code_words),
    'old_eggs', (select count(*) from egg_codes),
    'epoch', setting_int('progress_epoch', 0))
$$;
revoke all on function public._db_summary() from public, anon, authenticated;

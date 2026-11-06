-- v14: печатные QR — тайники и «Я — скорость» на 7 и 8 ноября.
-- В базе лежат только отпечатки кодов (sha256 от «shpa:» + код): репозиторий открытый, а сами коды есть только на распечатке.
-- QR ведёт на t.me/shpa_game_bot?startapp=t_КОД — открывается и обычной камерой, и сканером в игре; код под QR можно ввести руками.
-- Старые тестовые тайники CACHE-01…10 и CACHE-GOLD удаляются (они видны в коде). Организаторам печатные коды баллы
-- не начисляют и «не расходуют» — можно проверить каждую распечатку, не сжигая золотой тайник и места в пятёрке.

create table if not exists public.print_codes (
  hash text primary key,
  kind text not null check (kind in ('cache', 'cache_gold', 'speed')),
  n int not null default 0,
  day date,
  points int not null default 0,
  max_claims int not null default 0,
  title text not null
);
create table if not exists public.print_claims (
  hash text not null references public.print_codes(hash) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (hash, player_id)
);
alter table public.print_codes enable row level security;
alter table public.print_claims enable row level security;

insert into public.print_codes (hash, kind, n, day, points, max_claims, title) values
  ('c1c189b0894d1a09bc93e575dcbd8585073a289db51ba7be2dd97f2605aa6da5', 'cache', 1, null, 15, 0, 'Тайник №1'),
  ('69aa1a87971d9ce7ec58da8e03fae4007df33602fecafed575e66526f80723a9', 'cache', 2, null, 15, 0, 'Тайник №2'),
  ('c1a3f003506f2c85c2f6e4f449a8b65db374c10bc216108f8adb415ca62ae442', 'cache', 3, null, 15, 0, 'Тайник №3'),
  ('b150c1d6a1b8bd082683454c9349a6efd54661e6652da81c8f52a688de9a5696', 'cache', 4, null, 15, 0, 'Тайник №4'),
  ('90b35888d286b90ff120d76d03eac4b57d233536a3729bd6391c5223414c14c1', 'cache', 5, null, 15, 0, 'Тайник №5'),
  ('c4115ccbb805a011d6d7189b2394556455c3d163f8398faeffba74960565e71c', 'cache', 6, null, 15, 0, 'Тайник №6'),
  ('9f892e7550d4ee7a992dcb543f1bb0abac1aaf515c9ad434afbb48489bca7ec0', 'cache', 7, null, 15, 0, 'Тайник №7'),
  ('b252025de1b13ad23659269aed39e71b9e128ea7609e5edbc6132fc72d2b7d6e', 'cache', 8, null, 15, 0, 'Тайник №8'),
  ('be7dd200e4480e71335e20d6c7d85cb144cbbd85f706599bc4f3e141f63bbe39', 'cache', 9, null, 15, 0, 'Тайник №9'),
  ('6032c587a0baba6aac2c3e0ce0954849b3ab9b36e5874c9fbf32cd230e8cdb38', 'cache', 10, null, 15, 0, 'Тайник №10'),
  ('77778bd4cb2ce76658825b4ea46827c07354d07d4cdb4647c578ae5dc291dde1', 'cache_gold', 0, null, 100, 1, 'Золотой тайник'),
  ('200493f8e71ac94fc0aaa3761b6363a88651c0c902ba93eb6712137af6f412fd', 'speed', 7, '2026-11-07'::date, 30, 5, 'Я — скорость, 7 ноября'),
  ('0c659e2e3d0c7264edf9abf40a85ee977a53a11c26cf6c57a5ffa56726c2078b', 'speed', 8, '2026-11-08'::date, 30, 5, 'Я — скорость, 8 ноября')
on conflict (hash) do nothing;

-- тестовые тайники больше не работают
delete from public.cache_codes where code like 'CACHE-%';

/** Код из QR или с клавиатуры → вид для отпечатка: ссылка t.me/…?startapp=t_КОД → КОД, кириллица-двойники → латиница, только A–Z и цифры. */
create or replace function public._print_norm(p text) returns text language sql immutable as $$
  select regexp_replace(upper(translate(coalesce((regexp_match(coalesce(p, ''), 'startapp=t_([A-Za-z0-9]+)'))[1], coalesce(p, '')),
    'авекмнорстухАВЕКМНОРСТУХ', 'ABEKMHOPCTYXABEKMHOPCTYX')), '[^A-Z0-9]', '', 'g')
$$;

-- прежняя функция — внутренняя, снаружи её зовёт новая redeem_code
alter function public.redeem_code(text) rename to _redeem_code_base;
revoke all on function public._redeem_code_base(text) from public, anon, authenticated;

create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); me players; v text := _print_norm(p_code); pc print_codes; g int := 0; n int; msg text;
  link boolean := coalesce(p_code, '') ~ 'startapp=t_';
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if length(v) between 8 and 16 then
    select * into pc from print_codes where hash = encode(sha256(convert_to('shpa:' || v, 'UTF8')), 'hex') for update;
  end if;
  if pc.hash is null then
    if link then raise exception 'QR не распознан — такого кода в игре нет'; end if;
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
revoke all on function public._print_norm(text) from public, anon, authenticated;

-- Полный сброс чистит и находки по печатным QR
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
    'epoch', setting_int('progress_epoch', 0))
$$;
revoke all on function public._db_summary() from public, anon, authenticated;

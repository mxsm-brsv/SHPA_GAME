-- Проверка v17: QR из презентаций (пасхалки по блокам) и слово для «Рефлексии».
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
create or replace function pg_temp.fails(q text, pat text, what text) returns text language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like pat then return 'ok  ' || what || ' (' || sqlerrm || ')'; end if;
    raise exception 'ПРОВАЛ: % — не та ошибка: %', what, sqlerrm;
  end;
  raise exception 'ПРОВАЛ: % — ошибки не было', what;
end $$;
set test.role = '';
set test.uid = '';
do $$ declare r bigint; u uuid; begin
  if not exists (select 1 from players where is_staff and roster_id is not null) then
    select id into r from roster where role in ('staff', 'admin') and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end if;
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 1 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select id as p1 from players where role = 'participant' and roster_id is not null order by id limit 1 \gset

\echo '--- 11 QR из презентаций и 11 слов'
select pg_temp.ok((select count(*) from print_codes where kind = 'egg') = 11, '11 QR блоков, в базе только отпечатки');
select pg_temp.ok((select count(*) from code_words where hint like 'Слово №% · блок «%') = 11, 'у 11 слов подписан блок');
-- тестовые QR: сегодня и завтра
insert into print_codes (hash, kind, n, day, points, max_claims, title) values
  (encode(sha256(convert_to('shpa:' || _print_norm('TSTEGG0001'), 'UTF8')), 'hex'), 'egg', 99, (now() at time zone 'Europe/Moscow')::date, 15, 0, 'Тестовый блок'),
  (encode(sha256(convert_to('shpa:' || _print_norm('TSTEGG0002'), 'UTF8')), 'hex'), 'egg', 98, (now() at time zone 'Europe/Moscow')::date + 1, 15, 0, 'Завтрашний блок');

\echo '--- участник сканирует QR со слайда'
set test.uid = :'p1';
select (select rating from players where id = :'p1') as r0 \gset
select pg_temp.ok((redeem_code('https://t.me/shpa_game_bot?startapp=t_TSTEGG0001')->>'granted')::int = 15, 'QR со слайда: +15');
select pg_temp.ok((select rating from players where id = :'p1') = :r0 + 15, 'рейтинг вырос на 15');
select pg_temp.ok(redeem_code('TSTEGG0001')->>'message' like 'QR блока «Тестовый блок» ты уже отсканировал', 'второй раз — «уже отсканировал»');
select pg_temp.fails($q$select redeem_code('TSTEGG0002')$q$, 'QR блока «Завтрашний блок» работает только%', 'QR другого дня не работает');
set test.uid = :'staff_id';
select pg_temp.ok(redeem_code('TSTEGG0001')->>'message' like 'Код верный: Тестовый блок (работает %, отсканировали 1)%', 'организатор проверяет QR — ничего не начисляется');
delete from print_codes where n in (98, 99) and kind = 'egg';
select _reset_all();
select pg_temp.ok((select count(*) from print_codes where kind = 'egg') = 11 and not exists (select 1 from print_claims), 'сброс: QR остаются, сканы чистятся');

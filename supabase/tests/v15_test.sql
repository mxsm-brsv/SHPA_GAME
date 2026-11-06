-- Проверка v15: кодовые слова — 10 слов из миграции (только отпечатки) и добавление новых в панели организатора.
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
create or replace function pg_temp.g(code text) returns int language sql as $$ select (redeem_code(code)->>'granted')::int $$;
create or replace function pg_temp.m(code text) returns text language sql as $$ select redeem_code(code)->>'message' $$;
set test.role = '';
set test.uid = '';

-- организатор и четыре участника, привязанные к списку (после прошлого сброса привязки сняты)
do $$ declare p uuid; r bigint; u uuid; begin
  if not exists (select 1 from players where is_staff and roster_id is not null) then
    select id into r from roster where role in ('staff', 'admin') and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u;
    perform roster_attach(r, u);
  end if;
end $$;
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
do $$ declare p uuid; r bigint; u uuid; begin
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 4 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u;
    perform roster_attach(r, u);
  end loop;
end $$;
select (array_agg(id order by id))[1] as p1, (array_agg(id order by id))[2] as p2, (array_agg(id order by id))[3] as p3, (array_agg(id order by id))[4] as p4
from (select id from players where role = 'participant' and roster_id is not null order by id limit 4) x \gset

\echo '--- 10 слов из миграции, тестовых пасхалок нет'
select pg_temp.ok((select count(*) from code_words where word is null) = 10, '10 слов организаторов, текста в базе нет — только отпечатки');
select pg_temp.ok(not exists (select 1 from egg_codes where code in ('ЭНЕРГИЯ', 'МОЛНИЯ', 'ЗОЛОТО')), 'ЭНЕРГИЯ, МОЛНИЯ, ЗОЛОТО удалены');
select pg_temp.ok((select lim from task_defs where id = 'egg') = '50', 'лимит пасхалок — 50');

\echo '--- ввод прощает регистр, пробелы, знаки, тире и латиницу-двойники (тестовые слова; настоящие — только отпечатками)'
insert into code_words (hash, hint, points) values
  (_word_hash('Сдвинь гору'), 'тест 1', 15), (_word_hash('Привет — союз!'), 'тест 2', 15), (_word_hash('ОКО'), 'тест 3', 15),
  (_word_hash('торт'), 'тест 4', 15), (_word_hash('торт за ёлку'), 'тест 5', 15);
set test.uid = :'p1';
select pg_temp.ok(pg_temp.g('сдвинь гору!') = 15, '«сдвинь гору!» +15');
select pg_temp.ok(pg_temp.m('СДВИНЬ   ГОРУ') = 'Это слово ты уже вводил', 'повтор другим регистром — «уже вводил»');
select pg_temp.ok(pg_temp.g('привет - союз') = 15, 'фраза с другим тире и без знаков');
select pg_temp.ok(pg_temp.g('око') = 15, 'короткое слово');
select pg_temp.ok(pg_temp.g('торт') = 15 and pg_temp.g('Торт за елку') = 15, '«торт» и «торт за ёлку» — разные слова, ё = е');
select pg_temp.ok(pg_temp.m('TOPT') = 'Это слово ты уже вводил', 'латинские T, O, P = русские');
select pg_temp.fails($q$select redeem_code('Сдвинь горы')$q$, 'Такого кодового слова нет%', 'опечатка в слове — понятная подсказка');

\echo '--- организатор добавляет слово в моменте'
set test.uid = :'staff_id';
select pg_temp.ok(jsonb_array_length(staff_word_add('Энергия ШПА', 25, 2, 10, false)) = 16, 'добавлено: 25 баллов, первым двум, 10 минут');
select pg_temp.ok((select (e->>'max')::int = 2 and (e->>'expires') is not null and e->>'by' is not null from jsonb_array_elements(staff_words()) e where e->>'text' = 'Энергия ШПА'), 'в списке: лимит, срок и кто добавил');
select pg_temp.fails($q$select staff_word_add('энергия  шпа!', 10)$q$, 'Такое слово уже есть%', 'то же слово второй раз не добавить');
select pg_temp.fails($q$select staff_word_add('я', 10)$q$, 'Слово слишком короткое%', 'слишком короткое');
select pg_temp.fails($q$select staff_word_add('Тест', 500)$q$, 'Баллы — от 1 до 100%', 'баллы больше 100 нельзя');
select pg_temp.ok(pg_temp.m('энергия шпа') like 'Слово верное: +25, ввели 0 из 2%', 'организатор проверяет слово — ничего не тратится');
set test.uid = :'p1';
select pg_temp.ok(pg_temp.m('энергия шпа') = 'Кодовое слово! +25 баллов · ты 1-й из 2', 'первый: +25, «1-й из 2»');
set test.uid = :'p2';
select pg_temp.ok(pg_temp.g('ЭНЕРГИЯ ШПА') = 25, 'второй: +25');
set test.uid = :'p3';
select pg_temp.ok(pg_temp.m('Энергия ШПА') = 'Опоздал: слово уже ввели первые 2', 'третий — опоздал');

\echo '--- срок, выключение, удаление'
set test.uid = :'staff_id';
select jsonb_array_length(staff_word_add('Быстрое слово', 10, null, 5)) as n \gset
update code_words set expires_at = now() - interval '1 minute' where word = 'Быстрое слово';
set test.uid = :'p3';
select pg_temp.ok(pg_temp.m('быстрое слово') = 'Время на это слово вышло', 'после срока — «время вышло»');
set test.uid = :'staff_id';
select (select e->>'id' from jsonb_array_elements(staff_words()) e where e->>'text' = 'Энергия ШПА') as wid \gset
select pg_temp.ok((select e->>'active' = 'false' from jsonb_array_elements(staff_word_set(:'wid', false)) e where e->>'id' = :'wid'), 'слово выключено');
select staff_word_set(:'wid', true) is not null as on_again \gset
select staff_word_set(:'wid', false) is not null as off_again \gset
set test.uid = :'p4';
select pg_temp.ok(pg_temp.m('энергия шпа') = 'Это слово больше не принимается', 'выключенное слово не принимается');
set test.uid = :'staff_id';
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(staff_word_delete(:'wid')) e where e->>'id' = :'wid'), 'слово удалено');

\echo '--- золотая пасхалка — раз в день'
select jsonb_array_length(staff_word_add('Золотая молния', 50, null, null, true)) as n \gset
select jsonb_array_length(staff_word_add('Вторая молния', 50, null, null, true)) as n \gset
set test.uid = :'p1';
select pg_temp.ok(pg_temp.m('золотая молния') = 'Золотая пасхалка! +50 баллов', 'золотая: +50');
select pg_temp.ok(pg_temp.m('вторая молния') = 'Золотая пасхалка сегодня уже засчитана', 'вторая золотая в тот же день — нет');

\echo '--- доступ и прочее'
set test.uid = :'p2';
select pg_temp.fails($q$select staff_words()$q$, 'staff only%', 'участнику список слов не виден');
select pg_temp.fails($q$select staff_word_add('Своё слово', 100)$q$, 'staff only%', 'участник не добавит слово');
select pg_temp.ok(pg_temp.g('TSTCACHE05') = 15, 'печатные тайники работают как раньше');
select pg_temp.ok(not has_function_privilege('authenticated', 'public._code_word_redeem(uuid, text)', 'execute'), 'внутреннюю функцию напрямую не вызвать');
select _reset_all();
select pg_temp.ok(not exists (select 1 from code_word_claims) and (select count(*) from code_words) >= 10, 'сброс чистит ввод, слова остаются');
select pg_temp.ok((_db_summary()->>'code_words')::int >= 10, 'сводка: число слов');

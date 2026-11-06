-- Проверка v12: команды голосования не по ПБ, человек вписывается по ФИО + команда, ✅/❌, своя команда — нельзя.
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
select id as staff_id from players where role = 'staff' limit 1 \gset
select id as p1 from players where role = 'participant' order by id limit 1 \gset
select id as p2 from players where role = 'participant' order by id offset 1 limit 1 \gset
select roster_attach(2, :'staff_id');
select roster_attach(3, :'p1');   -- Логунова Ксения, ИнЭИ
select roster_attach(4, :'p2');   -- Сухих Кира, ИЭЭ

\echo '--- организатор задаёт команды'
set test.uid = :'staff_id';
select pg_temp.ok(jsonb_array_length(staff_vote_setup('Работа со спонсорами', '[{"id": "t1", "name": "Энергия"}, {"id": "t2", "name": "Ток"}, {"id": "t3", "name": "Заряд"}]'::jsonb)->'teams') = 3, 'три команды со своими названиями');

\echo '--- вписаться по ФИО'
set test.uid = :'p1';
select pg_temp.ok(vote_join('Ксения Логунова', 't1')->>'myTeam' = 't1', 'себя: порядок слов любой');
select pg_temp.ok(vote_join('сухих кира', 't1')->>'joined' = 'Кира Сухих', 'товарища — в ту же команду (люди из разных ПБ)');
select pg_temp.ok(jsonb_array_length(vote_state()->'mates') = 2, 'видно состав своей команды');
select pg_temp.fails('select vote_join(''Пупкин Вася'', ''t2'')', 'Нет такого ФИО%', 'чужого ФИО нет в списке');
select pg_temp.fails('select vote_join(''Тигров Иван'', ''t2'')', '%допиши группу%', 'тёзки — просим группу');
select pg_temp.ok(vote_join('Тигров Иван', 't2', 'ЭР-22-24')->>'joined' = 'Иван Тигровв', 'с группой — нашёлся нужный');
select pg_temp.ok(vote_join('Сухих Кира', 't3')->>'joined' = 'Кира Сухих', 'до открытия команду можно сменить');
select pg_temp.fails('select vote_join(''Сухих Кира'', ''t9'')', 'Выбери команду', 'нет такой команды');

\echo '--- голосование: ✅ / ❌, за свою нельзя'
set test.uid = :'staff_id';
select staff_vote_control('open', null);
set test.uid = :'p1';
select pg_temp.fails('select vote_cast(''t1'', 1)', '%свою команду%', 'за свою команду (t1) — нельзя');
select pg_temp.ok(vote_cast('t3', 1)->'my'->>'t3' = '1', '✅ команде «Заряд»');
set test.uid = :'p2';
select pg_temp.fails('select vote_cast(''t3'', -1)', '%свою команду%', 'Кира теперь в «Заряде» — за неё нельзя');
select pg_temp.ok(vote_cast('t1', -1)->'my'->>'t1' = '-1', '❌ команде «Энергия»');
select pg_temp.fails('select vote_join(''Сухих Кира'', ''t1'')', 'Команду уже не поменять%', 'пока идёт голосование, команду не сменить');
select pg_temp.ok((select (t->>'size')::int from jsonb_array_elements(vote_state()->'teams') t where t->>'id' = 't1') = 1, 'в «Энергии» один человек');

\echo '--- организатор: составы, убрать, переименовать'
set test.uid = :'staff_id';
select pg_temp.ok(jsonb_array_length(staff_vote_members()->2->'people') = 1, 'организатор видит составы');
select staff_vote_kick(4);
select pg_temp.ok(jsonb_array_length(staff_vote_members()->2->'people') = 0, 'убрал человека из команды');
select staff_vote_setup('Работа со спонсорами', '[{"id": "t1", "name": "Энергия+"}, {"id": "t2", "name": "Ток"}, {"id": "t3", "name": "Заряд"}]'::jsonb);
select pg_temp.ok(jsonb_array_length(staff_vote_members()->0->'people') = 1 and staff_vote_members()->0->>'name' = 'Энергия+', 'переименование не сбивает составы');
set test.uid = :'p1';
select pg_temp.fails('select staff_vote_kick(3)', 'staff only', 'участник не убирает людей');
\echo 'ГОТОВО v12'

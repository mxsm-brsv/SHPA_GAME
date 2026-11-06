-- Проверка v13: поединки в правовухе.
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
/** Верный ответ на вопрос (как его отправило бы приложение). */
create or replace function pg_temp.good(id text) returns text language sql as $$
  select case format when 'yesno' then case when correct_bool then 'true' else 'false' end when 'choice' then correct_index::text else answer end from questions where id = $1
$$;
set test.role = '';
set test.uid = '';
select id as p1 from players where role = 'participant' and roster_id = 3 limit 1 \gset
select id as p2 from players where role = 'participant' and roster_id = 4 limit 1 \gset
update questions set active = true where true;

\echo '--- вызов и принятие'
set test.uid = :'p1';
select law_duel_create() as d1 \gset
select (:'d1'::jsonb)->>'id' as did, (:'d1'::jsonb)->>'code' as dcode \gset
select pg_temp.ok(jsonb_array_length((:'d1'::jsonb)->'qids') = 7 and length(:'dcode') = 5, 'вызов: 7 вопросов, код из 5 символов');
select pg_temp.ok(jsonb_array_length(law_duel_list()->'open') = 0, 'свой вызов не в списке открытых');
set test.uid = :'p2';
select pg_temp.ok(jsonb_array_length(law_duel_list()->'open') = 1, 'соперник видит открытый вызов');
select pg_temp.ok(law_duel_join(lower(:'dcode'))->>'me' = 'b', 'принял вызов по коду (регистр не важен)');
select pg_temp.ok(exists (select 1 from notifications where player_id = :'p1' and text like '%принял твой вызов%'), 'бросившему пришло уведомление');
select pg_temp.fails(format('select law_duel_answer(%L, %L, %L)', :'did', (:'d1'::jsonb)->'qids'->>0, 'true'), 'Сначала начни%', 'без старта отвечать нельзя');

\echo '--- игрок 1 отвечает верно на всё, игрок 2 — на 5 из 7'
set test.uid = :'p1';
select law_duel_start(:'did');
select count(*) filter (where (law_duel_answer(:'did', q, pg_temp.good(q))->>'correct')::boolean) as right1
  from jsonb_array_elements_text((:'d1'::jsonb)->'qids') q \gset
select pg_temp.ok(:right1 = 7, 'все 7 верно засчитаны сервером');
select pg_temp.ok((law_duel_state(:'did')->'my'->>'done')::boolean and (law_duel_state(:'did')->'opp'->>'right')::int = 0, 'закончил — видит, сколько верных у соперника');
set test.uid = :'p2';
select pg_temp.ok((law_duel_state(:'did')->'opp'->>'right') is null and (law_duel_state(:'did')->'opp'->>'done')::boolean, 'соперник видит, что первый закончил, но не его счёт');
select law_duel_start(:'did');
select law_duel_answer(:'did', q, case when n <= 5 then pg_temp.good(q) else '__timeout__' end)
  from jsonb_array_elements_text((:'d1'::jsonb)->'qids') with ordinality x(q, n);
select pg_temp.ok(law_duel_state(:'did')->>'result' = 'loss' and law_duel_state(:'did')->'score' = '[5, 7]'::jsonb, 'итог у второго: поражение 5:7');
set test.uid = :'p1';
select pg_temp.ok(law_duel_state(:'did')->>'result' = 'win', 'у первого — победа');
select pg_temp.ok(exists (select 1 from notifications where player_id = :'p1' and text like 'Правовой поединок с % победа 7:5'), 'итог пришёл уведомлением');
select pg_temp.ok((law_duel_list()->'board'->0->>'wins')::int = 1, 'лучшие поединщики: 1 победа');
select pg_temp.fails(format('select law_duel_answer(%L, %L, %L)', :'did', (:'d1'::jsonb)->'qids'->>0, 'true'), '%уже ответил%', 'повторно не ответить');
select pg_temp.fails('select law_duel_join(''ZZZZZ'')', 'Вызов не найден%', 'неверный код');
set test.uid = :'p2';
\echo 'ГОТОВО v13'

-- Проверка миграции v3 (после v2_test.sql: игроки и список уже есть). Не для продакшена.
\set ON_ERROR_STOP 1
select id as admin_id from players where role = 'admin' \gset
select id as p1 from players where faction = 'inei' \gset
select id as p2 from players where faction = 'iee' \gset
set test.role = '';

\echo '--- задание на проверку: короткий текст, норм, повтор, отказ с причиной → уведомление, повторная сдача, приём'
set test.uid = :'p1';
do $$ begin perform submit_task('new_contest', 'коротко', null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select submit_task('new_contest', repeat('Конкурс для студактива. ', 12), null);
do $$ begin perform submit_task('new_contest', repeat('Ещё раз. ', 30), null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform submit_task('daily_login', 'x', null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select my_tasks()->'pending' as pending;
set test.uid = :'admin_id';
select id as sub1 from submissions where task = 'new_contest' order by id desc limit 1 \gset
select staff_review(:sub1, false, 0, 'Нужно описать правила', 'Новый конкурс');
set test.uid = :'p1';
select jsonb_array_length(my_notes()) as notes, my_notes()->0->>'text' as last_note;
select my_tasks()->'subs'->0->>'status' as st, my_tasks()->'subs'->0->>'note' as note;
select submit_task('new_contest', repeat('Конкурс «Профбюро за 60 секунд». ', 10), null);
set test.uid = :'admin_id';
select id as sub2 from submissions where task = 'new_contest' and status = 'pending' \gset
select staff_review(:sub2, true, 30, null, 'Новый конкурс')->>'granted' as granted;
select staff_review(:sub2, true, 30, null, 'Новый конкурс')->>'ok' as again_ok;
set test.uid = :'p1';
select my_notes()->0->>'text' as note2, my_tasks()->'done'->>'new_contest' as done;
do $$ begin perform submit_task('new_contest', repeat('Третий раз. ', 30), null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select notes_read(array(select (x->>'id')::bigint from jsonb_array_elements(my_notes()) x));
select count(*) filter (where (x->>'read')::boolean) as read_n from jsonb_array_elements(my_notes()) x;
\echo '--- ежедневное задание: ключ «задание@день»'
select submit_task('likes', null, (select :'p1') || '/likes.jpg');
set test.uid = :'admin_id';
select staff_review((select id from submissions where task = 'likes' and status = 'pending'), true, 10, null, 'Лайки');
set test.uid = :'p1';
select my_tasks()->'done' ? ('likes@' || to_char(msk_day(), 'YYYY-MM-DD')) as daily_key;
\echo '--- чужие функции: участник не может проверять и начислять'
do $$ begin perform staff_review(1, true, 100, null, null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform service_grant_task((select id from players where faction = 'inei'), 'tg_channel'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;

\echo '--- квиз: число от клиента не учитывается, считаем ответы'
insert into questions (id, format, topic, question, correct_bool, explanation, source, active) values
  ('t_q1', 'yesno', 'Учёба и аттестация', 'Тест 1', true, '', '', true), ('t_q2', 'yesno', 'Учёба и аттестация', 'Тест 2', false, '', '', true),
  ('t_q3', 'yesno', 'Учёба и аттестация', 'Тест 3', true, '', '', true) on conflict do nothing;
update questions set active = false where id not like 't\_%';
select quiz_start('docs_quiz') as qz \gset
select (:'qz'::jsonb)->>'id' as qid \gset
select jsonb_array_length((:'qz'::jsonb)->'questions') as n_q, ((:'qz'::jsonb)->'questions'->0) ? 'correct' as leaks_answer;
select check_answer('t_q1', 'true')->>'correct' as a1, check_answer('t_q2', 'true')->>'correct' as a2, check_answer('t_q2', 'false')->>'correct' as a2_retry, check_answer('t_q3', 'true')->>'correct' as a3;
select claim_auto_task('docs_quiz', 3, null, :'qid')->>'granted' as granted_2_right;
do $$ begin perform claim_auto_task('docs_quiz', 3, null, null); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform claim_auto_task('docs_quiz', 3, null, current_setting('test.qid', true)); exception when others then raise notice 'ожидаемо (повтор): %', sqlerrm; end $$;
update questions set active = true where true;

\echo '--- QR: «Я — скорость» — статичный код, первые 2, раз в день; активность'
set test.uid = :'admin_id';
select staff_lecture_open('Скорость', 30, 600, 'speed', 2, false) as sp \gset
select (:'sp'::jsonb)->>'code' as scode, (:'sp'::jsonb)->>'kind' as kind, (:'sp'::jsonb)->>'maxClaims' as mx \gset
select :'kind' as kind, :'mx' as max_claims, length(:'scode') as code_len;
set test.uid = :'p1';
select lectures_open()->0 ? 'code' as code_leaks, lectures_open()->0 ? 'secret' as secret_leaks;
select redeem_code(:'scode')->>'message' as s1;
select redeem_code(:'scode')->>'message' as s1_again;
set test.uid = :'p2';
select redeem_code(lower(:'scode'))->>'message' as s2;
select id as p3 from players where faction = 'ire' and roster_id is not null limit 1 \gset
set test.uid = :'p3';
select redeem_code(:'scode')->>'message' as s3_late;
set test.uid = :'admin_id';
select staff_lecture_open('Скорость-2', 30, 600, 'speed', 5, false) as sp2 \gset
set test.uid = :'p1';
select redeem_code((:'sp2'::jsonb)->>'code')->>'message' as speed_second_today;
set test.uid = :'admin_id';
select (staff_lecture_open('Мастер-класс', 10, 15, 'activity', 0, true)->>'secret') as asec \gset
set test.uid = :'p1';
select redeem_code(rot_code(:'asec', floor(extract(epoch from now()) / 20)::bigint))->>'message' as activity;

\echo '--- свои вопросы: проверка формата, лимит, приём в банк'
do $$ begin perform suggest_question('{"format":"choice","question":"Сколько будет 2+2?","options":["4"],"correct":0}'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select suggest_question('{"format":"choice","topic":"Стипендии","question":"Как часто выплачивают стипендию?","options":["Ежемесячно","Раз в семестр"],"correct":0,"explanation":"п. 18 Порядка № 1663"}');
select suggest_question('{"format":"input","question":"Как называется орган, который рассматривает споры в вузе?","answer":"Комиссия","accepted":["кус"]}');
set test.uid = :'admin_id';
select jsonb_array_length(staff_questions()) as pending_q;
select staff_question_review((select id from user_questions where q->>'format' = 'choice'), true);
select staff_question_review((select id from user_questions where q->>'format' = 'input'), false);
select id, format, correct_index, options, approved, active, source from questions where id like 'u\_%';
set test.uid = :'p1';
select my_notes()->0->>'text' as q_note;
select exists (select 1 from jsonb_array_elements(prep_bank()) x where x->>'id' like 'u\_%') as in_prep;

\echo '--- тест по коду: создать, открыть без входа, ограничения'
select share_test('{"name":"Стипендии","ids":["t_q1","t_q2"],"extra":[],"timer":30}') as tcode \gset
select length(:'tcode') as code_len;
set test.uid = '';
select get_shared_test(lower(:'tcode'))->>'name' as name, get_shared_test(:'tcode')->'ids' as ids, get_shared_test('NOPE00') is null as missing;
do $$ begin perform share_test('{"name":"x","ids":["a"]}'); exception when others then raise notice 'ожидаемо (без входа): %', sqlerrm; end $$;
set test.uid = :'p1';
do $$ begin perform share_test('{"name":"x","ids":[]}'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;

\echo '--- загрузка банка: только сервис, выключает лишнее, не трогает вопросы участников'
do $$ begin perform seed_questions('[]'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
set test.role = 'service_role';
select seed_questions('[{"id":"t_q1","format":"yesno","topic":"Учёба и аттестация","question":"Тест 1 (новый текст)","correct":false},{"id":"t_c","format":"choice","topic":"Стипендии","question":"Выбор","options":["a","b","c"],"correct":2},{"id":"t_i","format":"input","topic":"Стипендии","question":"Ввод","answer":"Ответ","accepted":["ответ","отв"]}]') as seeded;
select id, active, correct_bool, correct_index, answer, accepted, question from questions where id in ('t_q1', 't_q2', 't_c', 't_i') or id like 'u\_%' order by id;
select service_note_for((select max(id) from submissions where status <> 'pending')) as note_for_bot;
select service_grant_task(:'p2', 'tg_channel')->>'granted' as tg_granted, service_grant_task(:'p2', 'tg_channel')->>'granted' as tg_again;
set test.role = '';
\echo 'ГОТОВО v3'

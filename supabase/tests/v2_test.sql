-- Проверка миграции v2 на локальном PostgreSQL (после stub.sql и всех миграций). Не для продакшена.
\set ON_ERROR_STOP 1
set test.uid = '';
-- список: 8 человек ИРЭ (лимит 7), 1 ИЭЭ, админ и организатор
insert into roster (fio, fio_norm, grp, grp_norm, faction, role) values
 ('Админов Админ Админович', norm_fio('Админов Админ Админович'), '', '', 'profkom', 'admin'),
 ('Оргова Орга Орговна', norm_fio('Оргова Орга Орговна'), '', '', 'profkom', 'staff'),
 ('Логунова Ксения Александровна', norm_fio('Логунова Ксения Александровна'), 'ИЭ-23-25', norm_group('ИЭ-23-25'), 'inei', 'participant'),
 ('Сухих Кира Александровна', norm_fio('Сухих Кира Александровна'), 'Э-02-25', norm_group('Э-02-25'), 'iee', 'participant');
insert into roster (fio, fio_norm, grp, grp_norm, faction, role)
  select 'Тигров' || i || ' Иван Иванович', norm_fio('Тигров' || chr(1072 + i) || ' Иван Иванович'), 'ЭР-2' || i || '-24', norm_group('ЭР-2' || i || '-24'), 'ire', 'participant' from generate_series(1, 8) i;
update roster set fio = 'Тигров' || chr(1072 + (substr(grp, 5, 1))::int) || ' Иван Иванович' where faction = 'ire';

\echo '--- вход: опечатка в фамилии, группа латиницей'
select roster_login('логунрва ксения', 'IE 23 25', null, null, 'dev1', 'k1');
\echo '--- вход: неверная группа'
select roster_login('Логунова Ксения Александровна', 'ИЭ-24-25', null, null, 'dev2', 'k2');
\echo '--- вход: тот же человек с другого устройства'
select roster_login('Логунова Ксения', 'ИЭ-23-25', null, null, 'dev9', 'k3');
\echo '--- вход: тот же человек с того же устройства'
select roster_login('Логунова Ксения', 'ИЭ-23-25', null, null, 'dev1', 'k4');
\echo '--- организатор без кода и с кодом'
select roster_login('Оргова Орга', '', 'WRONG', null, 'd-o', 'k5');
select roster_login('Оргова Орга', '', 'ORG-TEST', null, 'd-o', 'k6');
\echo '--- Telegram: первый вход по ФИО, потом без ФИО'
select roster_login('Сухих Кира', 'Э-02-25', null, 777, null, 'tg777');
select roster_login(null, null, null, 777, null, 'tg777');
select roster_login(null, null, null, 778, null, 'tg778');

-- создаём игроков как это делает функция входа
do $$
declare r record; u uuid;
begin
  for r in select * from roster loop
    u := gen_random_uuid();
    insert into auth.users (id) values (u);
    perform roster_attach(r.id, u);
  end loop;
end $$;
\echo '--- лимит 7 в ПБ: привязываем 8 тигров'
select (roster_login('Тигров' || chr(1072 + i) || ' Иван', 'ЭР-2' || i || '-24', null, null, 'dt' || i, 'kt' || i))->>'error' as err, i from generate_series(1, 8) i;
\echo '--- «Собрать всё ПБ»: ИЭЭ (1 человек) получил +15'
select username, rating from players where faction = 'iee';

-- игроки для сценариев
select id as admin_id from players where role = 'admin' \gset
select id as p1 from players where faction = 'inei' \gset
select id as p2 from players where faction = 'iee' \gset

\echo '--- код: SQL и JS должны совпасть (rot_code(abc,123))'
select rot_code('abc', 123) as sql_code;

set test.uid = :'p1';
\echo '--- me / клан / вклад'
select me()->>'username' as me, me()->>'role' as role;
select contribute('kassa', 500)->>'accepted' as acc1;
select contribute('kassa', 5000)->>'accepted' as acc2_capped;
select get_clan()->'xp' as xp;
\echo '--- save_progress: подменённая сила режется'
select save_progress('{"v":1}'::jsonb, 99999999, 60);
select power, stage from players where id = :'p1';
\echo '--- мерч: закрыт → открыт, покупка, лимит в одни руки, нехватка баллов, остаток'
set test.uid = :'admin_id';
select staff_merch_import('[{"name":"Ремувки","stock":2,"price":10,"emoji":"🏷️"},{"name":"Худи","stock":1,"price":900}]'::jsonb);
update settings set value = 'false' where key = 'test_mode';
set test.uid = :'p1';
do $$ begin perform merch_buy((select id from merch_items where name = 'Ремувки')); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
update settings set value = 'true' where key = 'test_mode';
set test.uid = :'admin_id';
select staff_set_setting('shop_open', true);
update players set rating = 50 where id = :'p1';
update players set rating = 40 where id = :'p2';
set test.uid = :'p1';
select merch_buy((select id from merch_items where name = 'Ремувки'))->>'price' as bought;
do $$ begin perform merch_buy((select id from merch_items where name = 'Ремувки')); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform merch_buy((select id from merch_items where name = 'Худи')); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select my_wallet();
set test.uid = :'p2';
select merch_buy((select id from merch_items where name = 'Ремувки'))->>'price' as bought2;
select name, stock from merch_items order by name;
\echo '--- автоскидка: «Худи» не продаётся 7 часов → −20%'
update merch_items set auto_hours = 3, auto_step = 10, auto_max = 40, last_sale_at = now() - interval '7 hours' where name = 'Худи';
select name, price, merch_price(i) from merch_items i where name = 'Худи';
\echo '--- отмена заказа возвращает товар и баллы'
set test.uid = :'admin_id';
select staff_order_set((select id from merch_orders where player_id = :'p2'), 'cancelled');
set test.uid = :'p2';
select my_wallet();
select name, stock from merch_items where name = 'Ремувки';

\echo '--- блок: открыть, отметиться текущим кодом, повтор, старый код'
set test.uid = :'admin_id';
select staff_lecture_open('Гранты', 15, 7)->>'id' as lid \gset
select secret as lsec from lectures where id = :'lid' \gset
set test.uid = :'p1';
select redeem_code('SHPA:L:' || rot_code(:'lsec', floor(extract(epoch from now()) / 20)::bigint))->>'message' as m1;
select redeem_code(rot_code(:'lsec', floor(extract(epoch from now()) / 20)::bigint))->>'message' as m2;
do $$ begin perform redeem_code('SHPA:L:' || rot_code((select secret from lectures limit 1), floor(extract(epoch from now()) / 20)::bigint - 5)); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select lectures_open();

\echo '--- знакомство по личному обновляемому QR и отметка на заезде'
select secret as s2 from players where id = :'p2' \gset
select redeem_code('SHPA:P:' || rot_code(:'s2', floor(extract(epoch from now()) / 30)::bigint))->>'message' as meet;
do $$ begin perform redeem_code('SHPA:P:' || rot_code((select secret from players where faction = 'iee'), floor(extract(epoch from now()) / 30)::bigint)); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
set test.uid = :'admin_id';
select staff_checkin(rot_code(:'s2', floor(extract(epoch from now()) / 30)::bigint - 1));
select staff_checkin('ABCDEF');
\echo '--- организатор не может то, что только для админа'
select id as org from players where role = 'staff' \gset
set test.uid = :'org';
do $$ begin perform staff_roster_import('[]'::jsonb); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select jsonb_array_length(staff_roster()) as roster_rows;
select staff_roster_reset((select id::text from roster where fio like 'Сухих%'));
\echo '--- участник не может в панель'
set test.uid = :'p1';
do $$ begin perform staff_orders(); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
\echo '--- рейтинг'
select jsonb_array_length(leaderboard2()->'players') as players, (leaderboard2()->'factions'->0) as top_pb;
\echo '--- стычка: сила с учётом ратуши и Штаба'
update pb_buildings set xp = 3000 where faction = 'ire';
select ratusha_level('ire') as rat_ire, round(strike_power('ire', 'attack', 1000, 1, 0.5)) as s_ire, round(strike_power('inei', 'attack', 1000, 1, 0.5)) as s_inei;
\echo '--- эфир'
set test.uid = :'admin_id';
select staff_announce('Тест эфира', 'alert', 30);
select live_feed()->0->>'text' as live;
\echo '--- конфиг и подготовка (без входа)'
insert into questions (id, format, topic, level, question, options, correct_bool, correct_index, answer, accepted, explanation, source) select x->>'id', x->>'format', x->>'topic', (x->>'level')::int, x->>'question', x->'options', case when x->>'format'='yesno' then (x->>'correct')::boolean end, case when x->>'format'='choice' then (x->>'correct')::int end, x->>'answer', (select array_agg(v) from jsonb_array_elements_text(x->'accepted') v), x->>'explanation', x->>'source' from jsonb_array_elements($q$[{"id": "q_beaea1ab", "format": "yesno", "topic": "Учёба и аттестация", "level": 1, "question": "За повторную пересдачу экзамена вуз вправе взять со студента плату", "explanation": "Нет (Согласно ч. 7 ст. 58 Федерального закона № 273-ФЗ «Об образовании в РФ»: взимание платы с обучающихся за прохождение промежуточной аттестации не допускается)", "source": "ФЗ 273.pdf", "correct": false}, {"id": "q_66750d39", "format": "yesno", "topic": "Учёба и аттестация", "level": 1, "question": "Пройти промежуточную аттестацию по предмету с академической задолженностью можно не более трёх раз в пределах одного года с момента её образования", "explanation": "Нет — не более двух раз в пределах одного года (Согласно ч. 5 ст. 58 Федерального закона № 273-ФЗ «Об образовании в РФ»: не более двух раз в пределах одного года; время болезни, академического отпуска и отпуска по беременности и родам в этот срок не включается)", "source": "ФЗ 273.pdf", "correct": false}, {"id": "q_e1230e24", "format": "input", "topic": "Учёба и аттестация", "level": 1, "question": "Назовите, кто принимает у студента промежуточную аттестацию во второй раз", "explanation": "Комиссия (Согласно ч. 6 ст. 58 Федерального закона № 273-ФЗ «Об образовании в РФ»: для проведения промежуточной аттестации во второй раз образовательной организацией создаётся комиссия)", "source": "ФЗ 273.pdf", "answer": "Комиссия", "accepted": ["комиссия", "комиссия вуза", "экзаменационная комиссия"]}, {"id": "q_4dfa38cc", "format": "choice", "topic": "Учёба и аттестация", "level": 1, "question": "Сколько уровней высшего образования установлено в Российской Федерации?", "explanation": "Три (Согласно ч. 5 ст. 10 Федерального закона № 273-ФЗ «Об образовании в РФ»: бакалавриат; специалитет и магистратура; подготовка кадров высшей квалификации)", "source": "ФЗ 273.pdf", "options": ["Два", "Три", "Четыре", "Пять"], "correct": 1}]$q$::jsonb) x;
select x as prep_q from jsonb_array_elements(prep_bank()) x where x->>'format' in ('choice','input');
set test.uid = '';
select get_config();
select jsonb_array_length(prep_bank()) as prep_questions;
\echo '--- мир: тестовое мероприятие и раунд'
set test.uid = :'admin_id';
select staff_start_event('sparta');
select get_world()->'event'->>'id' as ev;
select staff_force_round();
select (get_world()->>'round')::int as round_now;
\echo 'ГОТОВО'

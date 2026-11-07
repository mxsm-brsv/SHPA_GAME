-- Проверка «Кнопки» (v8): выбор команд, порядок нажатий по меткам времени, подтверждение мест,
-- фальстарт, метка из будущего, поздняя доставка, автозакрытие, вердикты и счёт, переигровка, лимит времени,
-- «нет связи», права анонимного ключа, смена устройства, список команд, свой код ведущего, новая игра.
\set ON_ERROR_STOP 1
set test.role = '';
set test.uid = '';
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;

\echo '--- регистрация: три капитана из Telegram и один из браузера'
select bz_register(1001, 'Аня Капитанова', 'anya')->>'token' as ta \gset
select bz_register(1002, 'Борис', null)->>'token' as tb \gset
select bz_register(1003, 'Вика', 'vika')->>'token' as tc \gset
select bz_register_web('device-key-0123456789', 'Гоша (ноутбук)')->>'token' as td \gset
select pg_temp.ok(bz_register_web('short', 'X')->>'ok' = 'false', 'короткий ключ устройства не принимается');
select id as t1 from bz_teams where num = 1 \gset
select id as t2 from bz_teams where num = 2 \gset
select id as t3 from bz_teams where num = 3 \gset
select id as t4 from bz_teams where num = 4 \gset
select pg_temp.ok((select count(*) from bz_teams where active) = 10, '10 профбюро загружены заранее');

\echo '--- выбор команды: одна команда — один капитан'
-- с v9 профбюро берётся из списка выезда (вход по ФИО); здесь — сразу проставляем, механику входа проверяет v9
update bz_clients set team_id = case ident when 'tg:1001' then :t1 when 'tg:1002' then :t1 when 'tg:1003' then :t3 else :t4 end, team_src = 'host' where true;
select pg_temp.ok(bz_claim(:'ta', :t1)->>'ok' = 'true', 'Аня берёт команду 1');
select pg_temp.ok(bz_claim(:'tb', :t1)->>'error' like '%уже жмёт Аня%', 'Борису команда 1 уже занята');
select pg_temp.ok(bz_claim(:'ta', :t4)->>'error' like '%только за свою%', 'Аня не может жать за чужую команду 4');
update bz_clients set team_id = :t2 where ident = 'tg:1002';
select pg_temp.ok(bz_claim(:'tb', :t2)->>'ok' = 'true', 'Борис (команда 2) берёт свою');
select pg_temp.ok(bz_unclaim(:'ta')->>'ok' = 'true', 'Аня отказалась жать');
select pg_temp.ok((select captain is null from bz_teams where id = :t1), '…и команда 1 освободилась');
select pg_temp.ok(bz_claim(:'ta', :t1)->>'ok' = 'true', 'Аня возвращается в команду 1');
select pg_temp.ok(bz_claim(:'tc', :t3)->>'ok' = 'true', 'Вика берёт команду 3');
select pg_temp.ok(bz_claim('чужой-токен', :t4)->>'code' = 'auth', 'без токена — нельзя');

\echo '--- ведущий'
-- код организатора вечерки в тестах — свой (настоящий хранится только отпечатком)
update bz_game set host_code_hash = _bz_hash(_bz_norm_code('Тест код вечерки')) where id = 1;
select pg_temp.ok(bz_host_login('не тот код', 'k1')->>'error' = 'Неверный код организатора', 'неверный код');
select pg_temp.ok(bz_host_login(setting_text('staff_code', ''), 'k1')->>'ok' = 'false', 'код организатора игры ШПА для вечерки не подходит');
select bz_host_login('«тест КОД вечерки»', 'k1')->>'token' as th \gset
select pg_temp.ok(length(:'th') = 48, 'код организатора вечерки подходит (регистр и кавычки не важны)');
select pg_temp.ok(bz_host_state('левый')->>'error' = 'auth', 'без входа ведущего состояния нет');
select pg_temp.ok((bz_host(:'th', 'settings', '{"countdown_ms": 0, "limit_ms": 0}')->'game'->>'countdown_ms')::int = 0, 'обратный отсчёт 0 для теста');

\echo '--- вопрос 1: порядок по метке касания, а не по приходу'
-- вопрос «начался» 10 секунд назад: так можно слать метки +300/+500 мс без ожидания
select bz_host(:'th', 'start') is not null;
update bz_rounds set opens_ms = opens_ms - 10000, created_ms = created_ms - 10000, closes_ms = closes_ms - 10000 where id = (select round_id from bz_game);
select opens_ms as o1, id as r1 from bz_rounds where id = (select round_id from bz_game) \gset
select pg_temp.ok((select n from bz_rounds where id = :r1) = 1, 'вопрос № 1');
-- все трое отчитались «до старта нажатий не было»
select bz_tick(:'ta', 0, :o1 - 5) is not null, bz_tick(:'tb', 0, :o1 - 5) is not null, bz_tick(:'tc', 0, :o1 - 5) is not null;
-- Борис нажал на +500 мс, его пакет пришёл первым; Аня нажала на +300 мс, но связь медленнее — пришло позже
select pg_temp.ok(bz_press(:'tb', :r1, :o1 + 500, 40, 5)->>'code' = 'ok', 'нажатие Бориса принято');
select pg_temp.ok(bz_press(:'ta', :r1, :o1 + 300, 900, 40)->>'code' = 'ok', 'нажатие Ани (медленная связь) принято');
select pg_temp.ok((select string_agg(p->>'team', ',' order by (p->>'place')::int) from jsonb_array_elements(bz_screen()->'round'->'presses') p) = :t1 || ',' || :t2,
  'первая — Аня (нажала раньше), хотя её пакет пришёл позже');
select pg_temp.ok((bz_screen()->'round'->'presses'->0->>'confirmed') = 'false', 'место не подтверждено: Вика ещё не отчиталась за +300 мс');
select bz_tick(:'tc', 0, :o1 + 450) is not null;
select pg_temp.ok((bz_screen()->'round'->'presses'->0->>'confirmed') = 'true' and (bz_screen()->'round'->'presses'->1->>'confirmed') = 'false',
  'Вика отчиталась за +450: место Ани подтверждено, Бориса (+500) — ещё нет');
select pg_temp.ok((bz_screen()->'round'->'presses'->1->>'gap_ms')::float8 = 200, 'разрыв между 1 и 2 местом — 200 мс');
select pg_temp.ok((bz_screen()->'round'->'presses'->1->>'unsure') = 'false', 'разница 200 мс больше погрешностей (±40 и ±5) — порядок надёжный');

\echo '--- повтор и подмена'
select pg_temp.ok(bz_press(:'ta', :r1, :o1 + 100)->>'code' = 'dup', 'второе нажатие команды не меняет первое');
select pg_temp.ok((select press_ms from bz_presses where round_id = :r1 and team_id = :t1) = :o1 + 300, '…метка Ани осталась +300');
select pg_temp.ok(bz_press(:'tc', :r1, :o1 - 1000)->>'code' = 'early', 'нажатие до старта отклоняется');
select pg_temp.ok(bz_press(:'tc', :r1, bz_ms() + 5000)->'flags' ? 'future', 'метка из будущего: флаг future…');
select pg_temp.ok((select press_ms <= arrival_ms from bz_presses where round_id = :r1 and team_id = :t3), '…и время обрезано до времени прихода');
select pg_temp.ok((select status = 'closed' and closed_by = 'all' from bz_rounds where id = :r1), 'нажали все три команды — приём закрылся сам');

\echo '--- вердикты и счёт'
select pg_temp.ok((bz_host(:'th', 'verdict', jsonb_build_object('team', :t1, 'v', 'bad'))->'teams'->0->>'score')::int = -1, 'Аня ошиблась: −1');
select bz_host(:'th', 'verdict', jsonb_build_object('team', :t2, 'v', 'ok')) is not null;
select pg_temp.ok((select (t->>'score')::int from jsonb_array_elements(bz_screen()->'teams') t where (t->>'id')::int = :t2) = 1, 'Борис ответил верно: +1');
select pg_temp.ok(bz_host(:'th', 'verdict', jsonb_build_object('team', :t4, 'v', 'ok'))->>'error' like '%не нажимала%', 'вердикт без нажатия — ошибка');

\echo '--- вопрос 2: стоп ведущего и поздняя доставка'
select bz_host(:'th', 'start') is not null;
update bz_rounds set opens_ms = opens_ms - 10000, created_ms = created_ms - 10000, closes_ms = closes_ms - 10000 where id = (select round_id from bz_game);
select opens_ms as o2, id as r2 from bz_rounds where id = (select round_id from bz_game) \gset
select pg_temp.ok(:r2 <> :r1 and (select n from bz_rounds where id = :r2) = 2, 'вопрос № 2');
select bz_host(:'th', 'stop') is not null;
select (select closed_ms from bz_rounds where id = :r2) as c2 \gset
-- Вика нажала за 5 секунд до стопа, но телефон был без связи — пакет дошёл только сейчас
select pg_temp.ok((bz_press(:'tc', :r2, :c2 - 5000, 80, 10, 7)->'flags') ? 'late', 'нажатие до стопа, пришедшее поздно, принято с флагом late');
select pg_temp.ok(bz_press(:'tb', :r2, :c2 + 10)->>'code' = 'closed', 'нажатие после стопа отклоняется');

\echo '--- переигровка: вопрос отменён, номер не тратится'
select bz_host(:'th', 'verdict', jsonb_build_object('team', :t3, 'v', 'ok')) is not null;
select bz_host(:'th', 'void') is not null;
select pg_temp.ok((select (t->>'score')::int from jsonb_array_elements(bz_screen()->'teams') t where (t->>'id')::int = :t3) = 0, 'баллы отменённого вопроса не считаются');
select bz_host(:'th', 'start') is not null;
select (select round_id from bz_game) as r3 \gset
select pg_temp.ok((select n from bz_rounds where id = :r3) = 2, 'следующий вопрос снова № 2');
select pg_temp.ok(bz_press(:'tb', :r2, :c2 - 20)->>'code' = 'void', 'в отменённый вопрос нажимать нельзя');

\echo '--- лимит времени'
select bz_host(:'th', 'settings', '{"limit_ms": 100}') is not null;
select bz_host(:'th', 'start') is not null;
update bz_rounds set opens_ms = opens_ms - 10000, created_ms = created_ms - 10000, closes_ms = closes_ms - 10000 where id = (select round_id from bz_game);
select closes_ms as l4, id as r4 from bz_rounds where id = (select round_id from bz_game) \gset
select pg_temp.ok(bz_press(:'ta', :r4, :l4 + 50)->>'code' = 'timeout', 'после лимита — не принимается');
select pg_temp.ok(bz_press(:'ta', :r4, :l4 - 50)->>'code' = 'ok', 'до лимита — принимается');
select pg_temp.ok(bz_screen()->'round'->>'status' = 'closed' and bz_screen()->'round'->>'closed_by' = 'limit', 'по истечении лимита вопрос закрыт');
select bz_host(:'th', 'settings', '{"limit_ms": 0}') is not null;

\echo '--- «нет связи» не держит подтверждение'
select bz_host(:'th', 'start') is not null;
update bz_rounds set opens_ms = opens_ms - 10000, created_ms = created_ms - 10000, closes_ms = closes_ms - 10000 where id = (select round_id from bz_game);
select opens_ms as o5, id as r5 from bz_rounds where id = (select round_id from bz_game) \gset
update bz_clients set last_seen_ms = bz_ms() - 10000 where token_hash = _bz_hash(:'tc');
select bz_tick(:'tb', 0, :o5 + 2000) is not null;
select bz_press(:'ta', :r5, :o5 + 100) is not null;
select pg_temp.ok((bz_screen()->'round'->'presses'->0->>'confirmed') = 'true', 'Вика без связи 10 с — место Ани подтверждено без неё');
select pg_temp.ok((bz_screen()->'round'->'offline') @> to_jsonb(:t3), 'Вика в списке «нет связи»');
select pg_temp.ok((bz_screen()->'round'->'waiting') @> to_jsonb(:t2), 'Борис на связи и ещё не нажал');
-- Борис с плохой связью (±120 мс) нажал через 90 мс после Ани — порядок «под вопросом»
select pg_temp.ok((bz_press(:'tb', :r5, :o5 + 190, 900, 120)->'flags') ? 'asof', 'Борис раньше отчитался «не нажимал до +2 с» — флаг asof');
select pg_temp.ok((bz_screen()->'round'->'presses'->1->>'unsure') = 'true' and (bz_screen()->'round'->'presses'->1->>'tie') = 'false',
  'разница 90 мс меньше суммы погрешностей — отметка «под вопросом»');

\echo '--- что видят зал и ведущий'
select pg_temp.ok(not (bz_screen()::text like '%Капитанова%') and not (bz_screen()::text like '%anya%'), 'на экране зала нет имён капитанов');
select pg_temp.ok(bz_host_state(:'th')::text like '%Капитанова%', 'ведущий видит капитанов');
select pg_temp.ok((bz_host_state(:'th')->'round'->'presses'->0) ? 'delivery_ms', 'ведущий видит доставку и пинг');
select pg_temp.ok(jsonb_array_length(bz_host_state(:'th')->'history') >= 4, 'история вопросов у ведущего');
select pg_temp.ok((bz_tick(:'ta', 0, bz_ms())->'me'->>'team')::int = :t1, 'телефон знает свою команду');
select pg_temp.ok(bz_tick(:'ta', (select v from bz_game), bz_ms()) ? 'round', 'во время вопроса пульс всегда отдаёт состояние');

\echo '--- права анонимного ключа'
set role anon;
do $$ begin perform * from public.bz_clients; raise exception 'ПРОВАЛ: anon читает bz_clients'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.bz_register(1, 'x', 'y'); raise exception 'ПРОВАЛ: anon вызвал bz_register'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public._bz_view(true, null); raise exception 'ПРОВАЛ: anon вызвал _bz_view'; exception when insufficient_privilege then null; end $$;
select pg_temp.ok(public.bz_time() > 0, 'anon: время сервера доступно');
select pg_temp.ok(public.bz_tick(:'tb', 0, null) ? 't', 'anon: пульс работает');
select pg_temp.ok(public.bz_screen() ? 'teams', 'anon: экран зала работает');
reset role;

\echo '--- вход с другого телефона: старый токен больше не работает, команда остаётся'
select bz_register(1002, 'Борис', 'boris')->>'token' as tb2 \gset
select pg_temp.ok(bz_tick(:'tb', 0, null)->>'error' = 'auth', 'старый телефон Бориса выкинуло');
select pg_temp.ok((bz_tick(:'tb2', 0, null)->'me'->>'team')::int = :t2, 'новый телефон — та же команда');

\echo '--- список команд, замок, свой код ведущего'
select pg_temp.ok(jsonb_array_length(bz_host(:'th', 'teams', '{"names": ["А","Б","В","Г","Д","Е","Ж","З","И","К","Л","М"]}')->'teams') = 12, 'список из 12 команд');
select pg_temp.ok((select captain is not null from bz_teams where id = :t1), 'капитаны остались при переименовании');
select pg_temp.ok(jsonb_array_length(bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}')->'teams') = 10, 'снова 10');
select pg_temp.ok(bz_host(:'th', 'teams', '{"names": []}')->>'error' is not null, 'пустой список не принимается');
select bz_host(:'th', 'lock', '{"on": true}') is not null;
select pg_temp.ok(bz_claim(:'td', :t4)->>'error' like '%закрыл выбор%', 'замок: новых капитанов нет');
select pg_temp.ok(bz_unclaim(:'ta')->>'error' is not null, 'замок: капитан не уходит сам');
select bz_host(:'th', 'lock', '{"on": false}') is not null;
select pg_temp.ok(bz_host(:'th', 'host_code', '{"code": "аб"}')->>'error' is not null, 'короткий код не ставится');
select pg_temp.ok(bz_host(:'th', 'host_code', '{"code": ""}')->>'error' is not null, 'пустой код не ставится');
select bz_host(:'th', 'host_code', '{"code": "вечерка  2026"}') is not null;
select pg_temp.ok(bz_host_login('ВЕЧЕРКА 2026', 'k2')->>'ok' = 'true', 'новый код (регистр и пробелы не важны)');
select pg_temp.ok(bz_host_login('Тест код вечерки', 'k2')->>'ok' = 'false', 'старый код больше не подходит');
update bz_game set host_code_hash = _bz_hash(_bz_norm_code('Тест код вечерки')) where id = 1;
select bz_host(:'th', 'release', jsonb_build_object('team', :t3)) is not null;
select pg_temp.ok((select captain is null from bz_teams where id = :t3), 'ведущий освободил команду 3');

\echo '--- новая игра'
select bz_host(:'th', 'new_game') is not null;
select pg_temp.ok((select count(*) from bz_rounds) = 0 and (select coalesce(sum((t->>'score')::int), 0) from jsonb_array_elements(bz_screen()->'teams') t) = 0, 'вопросы и счёт обнулены');
select pg_temp.ok((select count(*) from bz_teams where captain is not null) = 2, 'капитаны на месте');
select pg_temp.ok((select v from bz_game) > 1, 'версия состояния растёт');
\echo 'ГОТОВО v8 (кнопка)'

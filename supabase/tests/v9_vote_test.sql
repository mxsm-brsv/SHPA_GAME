-- Проверка вечерки: свой список выезда, вход по ФИО и группе, подсказки, организаторы по коду и «Стать ведущим»,
-- кто жмёт кнопку, голосование за клипы.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
create or replace function pg_temp.cid(p_ident text) returns bigint language sql as $$ select id from bz_clients where ident = p_ident $$;

\echo '--- подготовка: код организатора, команды, клипы'
update bz_game set host_code_hash = _bz_hash(_bz_norm_code('Тест код вечерки')) where id = 1;
select pg_temp.ok(_bz_norm_code('«Молния  на логотипе»') = _bz_norm_code('молния на ЛОГОТИПЕ') and _bz_norm_code('MOЛНИЯ') = _bz_norm_code('молния'),
  'код: регистр, кавычки, пробелы и латинские двойники не важны');
select pg_temp.ok(bz_host_login(setting_text('staff_code', ''), 'v9')->>'ok' = 'false', 'код организатора игры ШПА не подходит');
select bz_host_login('тест код вечерки', 'v9')->>'token' as th \gset
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}') is not null;
select bz_host(:'th', 'release_all') is not null;
delete from bz_clients where true; -- после v8 в базе остались его телефоны
select pg_temp.ok((select string_agg(coalesce(code, '?'), ',' order by num) from bz_teams where active) = 'gpi,ivti,igvie,inei,ire,itae,ievt,iete,iee,enmi',
  'у всех 10 команд есть код профбюро');
select pg_temp.ok(_bz_code('Профбюро ИРЭ') = 'ire' and _bz_code('иэтэ') = 'iete' and _bz_code('ИЭЭ!') = 'iee' and _bz_code('Команда мечты') is null,
  'код по названию: «Профбюро ИРЭ», «иэтэ», «ИЭЭ!»; чужое название — без кода');
select pg_temp.ok((select count(*) from bz_clips where active) = 10, 'по клипу от каждого профбюро');
select id as ire from bz_teams where code = 'ire' \gset
select id as ivti from bz_teams where code = 'ivti' \gset
select id as gpi from bz_teams where code = 'gpi' \gset
select id as iee from bz_teams where code = 'iee' \gset
select id as clip_ire from bz_clips where team_id = :ire \gset
select id as clip_gpi from bz_clips where team_id = :gpi \gset
select id as clip_iee from bz_clips where team_id = :iee \gset

\echo '--- список выезда вечерки'
select pg_temp.ok(bz_host(:'th', 'roster', '{"rows": []}')->>'error' is not null, 'пустой список не загружается');
select bz_host(:'th', 'roster', jsonb_build_object('replace', true, 'rows', jsonb_build_array(
  jsonb_build_array('ИРЭ', 'Иванова Мария Сергеевна', 'ЭР-01-25'),
  jsonb_build_array('ГПИ', 'Смирнов Иван Петрович', 'ГП-02-24'),
  jsonb_build_array('ГПИ', 'Кузнецов Алексей', 'ГП-03-24'),
  jsonb_build_array('ГПИ', 'Климова Дарья', ''),
  jsonb_build_array('ИЭЭ', 'Дмитриев Дмитрий', 'Э-12-22'),
  jsonb_build_array('ИРЭ', 'Сидорова Анна', 'ЭР-02-25'),
  jsonb_build_array('ИВТИ', 'Козлов Артём Ильич', 'А-05-23'),
  jsonb_build_array('ИВТИ', 'Козлов Артём Олегович', 'А-05-23'),
  jsonb_build_array('', 'Гостева Ольга', ''),
  jsonb_build_array('ИРЭ', 'Один', 'ЭР-01-25')))) ->'loaded' as loaded \gset
select pg_temp.ok((:'loaded'::jsonb->>'added')::int = 9 and (:'loaded'::jsonb->>'bad')::int = 1 and (:'loaded'::jsonb->>'total')::int = 9,
  'загружено 9 человек, строка без имени пропущена');
select pg_temp.ok((select team_code from bz_roster where fio = 'Гостева Ольга') is null and (select team_code from bz_roster where fio = 'Климова Дарья') = 'gpi',
  'профбюро по названию; без профбюро — без команды');
select pg_temp.ok((bz_host_state(:'th')->'roster'->>'total')::int = 9, 'ведущий видит, сколько в списке');
select bz_host(:'th', 'roster', jsonb_build_object('rows', jsonb_build_array(jsonb_build_array('ИРЭ', 'Сидорова Анна', 'ЭР-03-25'))))->'loaded' as loaded \gset
select pg_temp.ok((:'loaded'::jsonb->>'updated')::int = 1 and (:'loaded'::jsonb->>'total')::int = 9 and (select grp from bz_roster where fio = 'Сидорова Анна') = 'ЭР-03-25',
  'догрузка без «заменить» обновляет и добавляет, никого не убирает');

\echo '--- подсказки'
select bz_register(9001, 'Маша', 'masha')->>'token' as tm \gset
select pg_temp.ok(bz_suggest('нет', 'fio', 'ив')->>'code' = 'auth', 'без телефона подсказок нет');
select pg_temp.ok(jsonb_array_length(bz_suggest(:'tm', 'fio', 'и')->'items') = 0, 'одна буква — подсказок нет');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'ива')->'items' = '["Иванова Мария Сергеевна", "Смирнов Иван Петрович"]', 'по первым буквам любого слова, сначала — фамилия');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'иванов')->'items' = '["Иванова Мария Сергеевна"]', 'чем больше букв, тем точнее');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'мар ив')->'items' = '["Иванова Мария Сергеевна"]', 'начала слов в любом порядке');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'козлов арт')->'items' = '["Козлов Артём Ильич", "Козлов Артём Олегович"]', 'тёзки — оба, по алфавиту');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'ё')->'items' = '[]' and bz_suggest(:'tm', 'fio', 'Артем')->'items' = '["Козлов Артём Ильич", "Козлов Артём Олегович"]',
  'ё и е — одно и то же');
select pg_temp.ok(bz_suggest(:'tm', 'grp', 'эр')->'items' = '["ЭР-01-25", "ЭР-03-25"]', 'группы по первым знакам');
select pg_temp.ok(bz_suggest(:'tm', 'grp', 'ЭР-0')->'items' = '["ЭР-01-25", "ЭР-03-25"]' and bz_suggest(:'tm', 'grp', 'эр 01')->'items' = '["ЭР-01-25"]',
  'дефис и пробел не мешают');
select pg_temp.ok(bz_suggest(:'tm', 'grp', 'zz')->'items' = '[]', 'нет такой группы — пусто');
update bz_clients set sugg_n = 240, sugg_at = now() where id = pg_temp.cid('tg:9001');
select pg_temp.ok(bz_suggest(:'tm', 'fio', 'ива')->'items' = '[]', 'больше 240 подсказок за 10 минут — пусто');
update bz_clients set sugg_n = 0 where id = pg_temp.cid('tg:9001');

\echo '--- вход участника'
select pg_temp.ok(not (bz_tick(:'tm', 0, null)->'me'->>'in')::boolean, 'открыла бота — телефон просит ФИО');
select pg_temp.ok(bz_claim(:'tm', :ire)->>'error' like '%войди по ФИО%', 'без входа кнопку не взять');
select pg_temp.ok(bz_login(:'tm', 'Иванова Мария', 'ЭР-01-24')->>'error' like '%Не нашли%', 'не та группа — не нашли');
select pg_temp.ok(bz_login(:'tm', 'Иванова Мария', '')->>'error' like '%группу%', 'без группы — просим группу');
select pg_temp.ok(bz_login(:'tm', 'мария иваноова', 'эр 01 25')->>'ok' = 'true', 'порядок слов любой, опечатка прощается, группа без дефисов');
select pg_temp.ok((select team_id = :ire and team_src = 'roster' and fio = 'Иванова Мария Сергеевна' and grp = 'ЭР-01-25' and name = 'Мария Иванова' and not org
  from bz_clients where id = pg_temp.cid('tg:9001')), 'Маша — в ИРЭ из списка, имя «Мария Иванова»');
select bz_register(9001, 'Маша', 'masha')->>'token' as tm \gset
select pg_temp.ok((select name = 'Мария Иванова' and roster_id is not null from bz_clients where id = pg_temp.cid('tg:9001')), 'перезапуск бота не сбрасывает вход');
select bz_register(9010, 'Чужой', null)->>'token' as tx \gset
select pg_temp.ok(bz_login(:'tx', 'Иванова Мария', 'ЭР-01-25')->>'error' like '%с другого телефона%', 'то же ФИО с другого телефона — нельзя');
select pg_temp.ok(bz_login(:'tx', 'Климова Дарья', '')->>'ok' = 'true', 'группы в списке нет — входит без группы');
select pg_temp.ok((bz_logout(:'tx')->'me'->>'in')::boolean = false, '«Это не я» — вышла');
select pg_temp.ok(bz_login(:'tx', 'Козлов Артём', 'А-05-23')->>'error' like '%несколько похожих%', 'тёзки — просим отчество');
select pg_temp.ok(bz_login(:'tx', 'Козлов Артем Олегович', 'А-05-23')->>'ok' = 'true', 'с отчеством — нашли нужного');
select pg_temp.ok((select fio = 'Козлов Артём Олегович' and team_id = :ivti from bz_clients where id = pg_temp.cid('tg:9010')), '…это Артём Олегович, ИВТИ');
select bz_logout(:'tx') is not null;
select bz_register(9020, 'Подбор', null)->>'token' as tb \gset
select count(*) from generate_series(1, 8) i where bz_login(:'tb', 'Неизвестный Человек', 'ЭР-01-25')->>'error' like '%Не нашли%';
select pg_temp.ok(bz_login(:'tb', 'Сидорова Анна', 'ЭР-03-25')->>'error' like '%Слишком много попыток%', '8 ошибок — пауза 15 минут');

\echo '--- организаторы и «Стать ведущим»'
select bz_register(9002, 'Олег', null)->>'token' as tp \gset
select pg_temp.ok(bz_host_enter(:'tp')->>'error' like '%только организатор%', 'участник не может стать ведущим');
select pg_temp.ok(bz_host_enter(:'tm')->>'error' like '%только организатор%', '…даже вошедший по ФИО');
select pg_temp.ok(bz_login(:'tp', 'Петров Олег', '', 'не тот')->>'error' like '%Неверный код%', 'неверный код организатора');
select pg_temp.ok(bz_login(:'tp', 'Петров Олег', '', setting_text('staff_code', ''))->>'error' like '%Неверный код%', 'код игры ШПА — не подходит');
select pg_temp.ok(bz_login(:'tp', 'петров олег', '', 'ТЕСТ КОД ВЕЧЕРКИ')->>'ok' = 'true', 'организатор: любое ФИО + код вечерки в любом регистре');
select pg_temp.ok((bz_tick(:'tp', 0, null)->'me'->>'org')::boolean and (bz_tick(:'tp', 0, null)->'me'->>'in')::boolean
  and bz_tick(:'tp', 0, null)->'me'->>'team' is null, 'организатор — без команды');
select pg_temp.ok((select fio = 'Петров Олег' and name = 'Петров Олег' from bz_clients where id = pg_temp.cid('tg:9002')), 'имя организатора — как написал, с заглавных');
select pg_temp.ok(bz_claim(:'tp', :gpi)->>'error' like '%Организаторы не жмут%', 'организатор кнопку не жмёт');
select bz_host_enter(:'tp')->>'token' as th2 \gset
select pg_temp.ok(length(:'th2') = 48 and bz_host_state(:'th2') ? 'teams', '«Стать ведущим» — открылась панель ведущего');
select pg_temp.ok((select m->>9 from jsonb_array_elements(bz_host_state(:'th2')->'members') m where (m->>0)::bigint = pg_temp.cid('tg:9002')) = 'true',
  'ведущий видит, что это организатор');

\echo '--- кто жмёт кнопку'
select bz_register(9003, 'Ваня', null)->>'token' as ts \gset
select bz_login(:'ts', 'Смирнов Иван', 'ГП-02-24') is not null;
select pg_temp.ok(bz_claim(:'ts', :ivti)->>'error' like '%только за свою%', 'кнопку за чужую команду не взять');
select pg_temp.ok(bz_claim(:'ts', :gpi)->>'ok' = 'true', 'за своё ГПИ — жмёт Ваня');
select bz_register(9005, 'Лёша', null)->>'token' as tl \gset
select bz_login(:'tl', 'Кузнецов Алексей', 'ГП-03-24') is not null;
select pg_temp.ok((select t->>'captain_name' from jsonb_array_elements(bz_tick(:'tl', 0, null)->'teams') t where (t->>'id')::int = :gpi) = 'Иван Смирнов',
  'товарищ по команде видит, кто жмёт');
select pg_temp.ok(bz_claim(:'tl', :gpi)->>'error' like '%уже жмёт Иван Смирнов%', 'второй за ту же команду не жмёт');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9005'))->>'error' like '%передать её может только он%', 'Лёша не может отнять кнопку у Вани');
select pg_temp.ok(bz_assign(:'ts', pg_temp.cid('tg:9005'))->>'ok' = 'true', 'Ваня передал кнопку Лёше');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9001'))->>'error' like '%не из твоего%', 'назначить человека из другого ПБ нельзя');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9003'))->>'ok' = 'true', 'Лёша вернул кнопку Ване');

\echo '--- голосование'
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'до открытия голосовать нельзя');
select bz_host(:'th', 'vote', '{"status": "open"}') is not null;
select pg_temp.ok(bz_vote(:'tb', :clip_ire)->>'error' like '%войди по ФИО%', 'не вошёл — не голосует');
select pg_temp.ok(bz_vote(:'tl', :clip_gpi)->>'error' like '%твоего профбюро%', 'за клип своего профбюро нельзя');
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'ok' = 'true', 'Лёша (ГПИ) — за клип ИРЭ');
select pg_temp.ok((bz_vote(:'tl', :clip_iee)->'me'->>'vote')::int = :clip_iee, 'передумал — за ИЭЭ');
select pg_temp.ok(bz_logout(:'tl')->>'error' like '%уже проголосовал%', 'проголосовал — выйти из ФИО нельзя');
select pg_temp.ok(bz_login(:'tl', 'Сидорова Анна', 'ЭР-03-25')->>'error' like '%уже проголосовал%', '…и войти под другим ФИО тоже');
select pg_temp.ok(bz_vote(:'tm', :clip_ire)->>'error' like '%твоего%', 'Маша (ИРЭ) за ИРЭ — нельзя');
select pg_temp.ok(bz_vote(:'tm', :clip_gpi)->>'ok' = 'true', 'Маша — за ГПИ');
select pg_temp.ok(bz_vote(:'tp', :clip_ire)->>'ok' = 'true', 'организатор — за любой клип');
select bz_register_web('browser-device-key-123456', 'Гость')->>'token' as tw \gset
select pg_temp.ok(bz_login(:'tw', 'Дмитриев Дмитрий', 'Э-12-22')->>'ok' = 'true', 'из браузера — тоже по ФИО');
select pg_temp.ok(bz_vote(:'tw', :clip_ire)->>'ok' = 'true', '…и голос принят');

\echo '--- кто видит итоги'
select pg_temp.ok(not (bz_screen()->'clips'->0 ? 'votes') and (bz_screen()->'vote'->>'total')::int = 4, 'зал видит только число голосов (4)');
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_host_state(:'th')->'clips') k where (k->>'id')::int = :clip_ire) = 2, 'ведущий видит: за ИРЭ — 2');
select bz_host(:'th', 'vote', '{"status": "closed"}') is not null;
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'после закрытия голос не поменять');
select bz_host(:'th', 'vote', '{"status": "shown"}') is not null;
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_screen()->'clips') k where (k->>'id')::int = :clip_iee) = 1, 'итоги показаны: ИЭЭ — 1');

\echo '--- ведущий поправляет'
select bz_host(:'th', 'member', jsonb_build_object('client', pg_temp.cid('tg:9005'), 'team', :iee)) is not null;
select pg_temp.ok(not exists(select 1 from bz_votes where client_id = pg_temp.cid('tg:9005')), 'Лёшу перевели в ИЭЭ — его голос за ИЭЭ снят');
select bz_host(:'th', 'unbind', jsonb_build_object('client', (select id from bz_clients where kind = 'web'))) is not null;
select pg_temp.ok((select roster_id is null from bz_clients where kind = 'web') and (select count(*) from bz_votes) = 2, 'ведущий сбросил вход — голос снят');
select bz_register(9030, 'Настоящий Дима', null)->>'token' as td \gset
select pg_temp.ok(bz_login(:'td', 'Дмитриев Дмитрий', 'Э-12-22')->>'ok' = 'true', '…и настоящий Дмитрий вошёл со своего телефона');
select bz_host(:'th', 'unbind', jsonb_build_object('client', pg_temp.cid('tg:9002'))) is not null;
select pg_temp.ok((select not org from bz_clients where id = pg_temp.cid('tg:9002')), 'сброс входа снимает и права организатора');
select pg_temp.ok(bz_host_enter(:'tp')->>'error' is not null, '…и «Стать ведущим» больше нельзя');

\echo '--- замена списка'
select bz_host(:'th', 'roster', jsonb_build_object('replace', true, 'rows', jsonb_build_array(
  jsonb_build_array('ИРЭ', 'Иванова Мария Сергеевна', 'ЭР-01-25'),
  jsonb_build_array('ИЭЭ', 'Иванова Мария Сергеевна', 'Э-01-25'),
  jsonb_build_array('ГПИ', 'Смирнов Иван Петрович', 'ГП-02-24'),
  jsonb_build_array('ГПИ', 'Кузнецов Алексей', 'ГП-03-24'))))->'loaded' as loaded \gset
select pg_temp.ok((:'loaded'::jsonb->>'removed')::int = 6 and (:'loaded'::jsonb->>'total')::int = 3, 'заменили: 3 человека, повтор ФИО не задвоился');
select pg_temp.ok((select roster_id is null and fio is null and team_id is null from bz_clients where id = pg_temp.cid('tg:9030')), 'кого убрали из списка — вход сброшен');
select pg_temp.ok((select team_id = :ire from bz_clients where id = pg_temp.cid('tg:9001')), 'остальные — на месте');

\echo '--- переименование команд'
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}') is not null;
select pg_temp.ok((select team_id is null from bz_clients where id = pg_temp.cid('tg:9001')), 'ИРЭ убрали из команд — Маша без команды');
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}') is not null;
select pg_temp.ok((select team_id = :ire from bz_clients where id = pg_temp.cid('tg:9001')), 'вернули ИРЭ — Маша снова в ней по списку');
select bz_host(:'th', 'vote_reset') is not null;
select pg_temp.ok((select count(*) from bz_votes) = 0 and (select vote_status from bz_game) = 'off', 'голоса сброшены');

\echo '--- права'
set role anon;
do $$ begin perform public._bz_view(true, null); raise exception 'ПРОВАЛ: anon вызвал _bz_view'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public._bz_roster_load('[]', false); raise exception 'ПРОВАЛ: anon загрузил список'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.bz_roster; raise exception 'ПРОВАЛ: anon читает список вечерки'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.bz_votes; raise exception 'ПРОВАЛ: anon читает голоса'; exception when insufficient_privilege then null; end $$;
select pg_temp.ok(public.bz_vote('нет', 1)->>'code' = 'auth', 'anon: голос без входа — auth');
select pg_temp.ok(public.bz_host_enter('нет')->>'code' = 'auth', 'anon: «Стать ведущим» без входа — auth');
reset role;
select bz_host(:'th', 'new_game') is not null;
delete from bz_roster where true;
\echo 'ГОТОВО вечерка (список, вход, подсказки, организаторы, голосование)'

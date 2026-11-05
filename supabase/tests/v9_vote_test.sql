-- Проверка v9: вход по ФИО и группе из списка выезда, кто жмёт кнопку, голосование за клипы.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
create or replace function pg_temp.cid(p_ident text) returns bigint language sql as $$ select id from bz_clients where ident = p_ident $$;

\echo '--- подготовка: новая игра, список выезда'
select bz_host_login(setting_text('staff_code', ''), 'v9')->>'token' as th \gset
select setting_text('staff_code', '') as staff \gset
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}') is not null;
select bz_host(:'th', 'release_all') is not null;
delete from bz_clients; -- после v8 в базе остались его телефоны
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
insert into roster (fio, fio_norm, grp, grp_norm, faction, role)
select f, norm_fio(f), g, norm_group(g), fa, ro from (values
  ('Иванова Мария Сергеевна', 'ЭР-01-25', 'ire', 'participant'),
  ('Петров Олег Игоревич', '', 'profkom', 'admin'),
  ('Смирнов Иван Петрович', 'ГП-02-24', 'gpi', 'participant'),
  ('Кузнецов Алексей', 'ГП-03-24', 'gpi', 'participant'),
  ('Дмитриев Дмитрий', 'Э-12-22', 'iee', 'participant'),
  ('Сидорова Анна', 'ЭР-02-25', 'ire', 'participant'),
  ('Козлов Артём Ильич', 'А-05-23', 'ivti', 'participant'),
  ('Козлов Артём Олегович', 'А-05-23', 'ivti', 'participant')
) v(f, g, fa, ro);

\echo '--- вход по ФИО и группе'
select bz_register(9001, 'Маша', 'masha')->>'token' as tm \gset
select pg_temp.ok(not (bz_tick(:'tm', 0, null)->'me'->>'in')::boolean, 'открыла из Telegram — телефон просит ФИО');
select pg_temp.ok(bz_claim(:'tm', :ire)->>'error' like '%войди по ФИО%', 'без входа кнопку не взять');
select pg_temp.ok(bz_login(:'tm', 'Иванова Мария', 'ЭР-01-24')->>'error' like '%Не нашли%', 'не та группа — не нашли');
select pg_temp.ok(bz_login(:'tm', 'Иванова Мария', '')->>'error' like '%группу%', 'без группы — просим группу');
select pg_temp.ok(bz_login(:'tm', 'мария иваноова', 'эр 01 25')->>'ok' = 'true', 'порядок слов любой, опечатка прощается, группа без дефисов');
select pg_temp.ok((select team_id = :ire and team_src = 'roster' and fio = 'Иванова Мария Сергеевна' and grp = 'ЭР-01-25' and name = 'Мария Иванова'
  from bz_clients where id = pg_temp.cid('tg:9001')), 'Маша — в ИРЭ из списка, имя «Мария Иванова»');
select pg_temp.ok((bz_tick(:'tm', 0, null)->'me'->>'in')::boolean and (bz_tick(:'tm', 0, null)->'me'->>'team')::int = :ire, 'телефон знает: вошла, ИРЭ');
select bz_register(9001, 'Маша', 'masha')->>'token' as tm \gset
select pg_temp.ok((select name = 'Мария Иванова' and roster_id is not null from bz_clients where id = pg_temp.cid('tg:9001')),
  'перезапуск из Telegram не сбрасывает вход и имя');
select pg_temp.ok(bz_login(:'tm', 'Иванова Мария', 'ЭР-01-25')->>'ok' = 'true', 'повторный вход тем же ФИО — ок');
select bz_register(9010, 'Чужой', null)->>'token' as tx \gset
select pg_temp.ok(bz_login(:'tx', 'Иванова Мария', 'ЭР-01-25')->>'error' like '%с другого телефона%', 'то же ФИО с другого телефона — нельзя');
select pg_temp.ok(bz_claim(:'tm', :ivti)->>'error' like '%только за свою%', 'жать кнопку за чужую команду нельзя');
select pg_temp.ok(bz_claim(:'tm', :ire)->>'ok' = 'true', 'за свою — можно');

\echo '--- тёзки, оргкомитет, лимит попыток'
select pg_temp.ok(bz_login(:'tx', 'Козлов Артём', 'А-05-23')->>'error' like '%несколько похожих%', 'тёзки в одной группе — просим отчество');
select pg_temp.ok(bz_login(:'tx', 'Козлов Артем Олегович', 'А-05-23')->>'ok' = 'true', 'с отчеством — нашли нужного');
select pg_temp.ok((select fio = 'Козлов Артём Олегович' and team_id = :ivti from bz_clients where id = pg_temp.cid('tg:9010')), '…это Артём Олегович, ИВТИ');
select pg_temp.ok((bz_logout(:'tx')->'me'->>'in')::boolean = false, '«Это не я» — вышел, пока не голосовал');
select pg_temp.ok((select roster_id is null and team_id is null from bz_clients where id = pg_temp.cid('tg:9010')), '…ФИО и профбюро сняты');
select bz_register(9002, 'Олег', null)->>'token' as tp \gset
select pg_temp.ok(bz_login(:'tp', 'Петров Олег', '')->>'error' like '%группу%', 'оргкомитет без кода ищется как участник');
select pg_temp.ok(bz_login(:'tp', 'Петров Олег', '', 'НЕ-ТОТ')->>'error' like '%Неверный код%', 'неверный код организатора');
select pg_temp.ok(bz_login(:'tp', 'Олег Петров', '', :'staff')->>'ok' = 'true', 'оргкомитет: ФИО + код организатора');
select pg_temp.ok((bz_tick(:'tp', 0, null)->'me'->>'org')::boolean and bz_tick(:'tp', 0, null)->'me'->>'team' is null, 'профком — без команды');
select pg_temp.ok(bz_claim(:'tp', :gpi)->>'error' like '%Оргкомитет не жмёт%', 'оргкомитет кнопку не жмёт');
select bz_register(9020, 'Подбор', null)->>'token' as tb \gset
select count(*) from generate_series(1, 8) i where bz_login(:'tb', 'Неизвестный Человек', 'ЭР-01-25')->>'error' like '%Не нашли%';
select pg_temp.ok(bz_login(:'tb', 'Сидорова Анна', 'ЭР-02-25')->>'error' like '%Слишком много попыток%', '8 ошибок — пауза 15 минут');

\echo '--- кто жмёт кнопку'
select bz_register(9003, 'Ваня', null)->>'token' as ts \gset
select bz_login(:'ts', 'Смирнов Иван', 'ГП-02-24') is not null;
select pg_temp.ok(bz_claim(:'ts', :ivti)->>'error' like '%только за свою%', 'кнопку за чужую команду не взять');
select pg_temp.ok(bz_claim(:'ts', :gpi)->>'ok' = 'true', 'за своё ГПИ — жмёт Ваня');
select pg_temp.ok((bz_tick(:'ts', 0, null)->'me'->>'captain')::boolean, 'телефон знает, что жмёт он');
select bz_register(9005, 'Лёша', null)->>'token' as tl \gset
select bz_login(:'tl', 'Кузнецов Алексей', 'ГП-03-24') is not null;
select pg_temp.ok((select t->>'captain_name' from jsonb_array_elements(bz_tick(:'tl', 0, null)->'teams') t where (t->>'id')::int = :gpi) = 'Иван Смирнов',
  'товарищ по команде видит, кто жмёт (имя из списка)');
select pg_temp.ok(bz_claim(:'tl', :gpi)->>'error' like '%уже жмёт Иван Смирнов%', 'второй за ту же команду не жмёт');
select pg_temp.ok((select (t->>'members')::int from jsonb_array_elements(bz_screen()->'teams') t where (t->>'id')::int = :gpi) = 2, 'в ГПИ двое');
select pg_temp.ok(jsonb_array_length(bz_tick(:'tl', 0, null)->'me'->'mates') = 2, 'Лёша видит двоих из своего ПБ');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9005'))->>'error' like '%передать её может только он%', 'Лёша не может отнять кнопку у Вани');
select pg_temp.ok(bz_assign(:'ts', pg_temp.cid('tg:9005'))->>'ok' = 'true', 'Ваня передал кнопку Лёше');
select pg_temp.ok((bz_tick(:'tl', 0, null)->'me'->>'captain')::boolean, 'теперь жмёт Лёша');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9001'))->>'error' like '%не из твоего%', 'назначить человека из другого ПБ нельзя');
select pg_temp.ok(bz_assign(:'tl', pg_temp.cid('tg:9003'))->>'ok' = 'true', 'Лёша вернул кнопку Ване');

\echo '--- голосование'
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'до открытия голосовать нельзя');
select bz_host(:'th', 'vote', '{"status": "open"}') is not null;
select pg_temp.ok(bz_vote(:'tx', :clip_ire)->>'error' like '%войди по ФИО%', 'не вошёл по ФИО — не голосует');
select pg_temp.ok(bz_vote(:'tl', :clip_gpi)->>'error' like '%твоего профбюро%', 'за клип своего профбюро нельзя');
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'ok' = 'true', 'Лёша (ГПИ) — за клип ИРЭ');
select pg_temp.ok((bz_vote(:'tl', :clip_iee)->'me'->>'vote')::int = :clip_iee, 'передумал — за ИЭЭ, телефон это видит');
select pg_temp.ok((select count(*) from bz_votes where client_id = pg_temp.cid('tg:9005')) = 1, 'голос один');
select pg_temp.ok(bz_logout(:'tl')->>'error' like '%уже проголосовал%', 'проголосовал — выйти из ФИО нельзя');
select pg_temp.ok(bz_login(:'tl', 'Сидорова Анна', 'ЭР-02-25')->>'error' like '%уже проголосовал%', '…и войти под другим ФИО тоже');
select pg_temp.ok(bz_vote(:'tm', :clip_ire)->>'error' like '%твоего%', 'Маша (ИРЭ) за ИРЭ — нельзя');
select pg_temp.ok(bz_vote(:'tm', :clip_gpi)->>'ok' = 'true', 'Маша — за ГПИ');
select pg_temp.ok(bz_vote(:'tp', :clip_ire)->>'ok' = 'true', 'оргкомитет — за любой клип');
select bz_register_web('browser-device-key-123456', 'Гость')->>'token' as tw \gset
select pg_temp.ok(bz_login(:'tw', 'Дмитриев Дмитрий', 'Э-12-22')->>'ok' = 'true', 'из браузера — тоже по ФИО');
select pg_temp.ok(bz_vote(:'tw', :clip_ire)->>'ok' = 'true', '…и голос принят');

\echo '--- кто видит итоги'
select pg_temp.ok(not (bz_screen()->'clips'->0 ? 'votes') and (bz_screen()->'vote'->>'total')::int = 4, 'зал видит только число голосов (4), без раскладки');
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_host_state(:'th')->'clips') k where (k->>'id')::int = :clip_ire) = 2,
  'ведущий видит: за ИРЭ — 2');
select pg_temp.ok((select m->>2 = 'Иванова Мария Сергеевна' and m->>8 = 'ЭР-01-25' from jsonb_array_elements(bz_host_state(:'th')->'members') m
  where (m->>0)::bigint = pg_temp.cid('tg:9001')), 'ведущий видит ФИО и группу');
select bz_host(:'th', 'vote', '{"status": "closed"}') is not null;
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'после закрытия голос не поменять');
select bz_host(:'th', 'vote', '{"status": "shown"}') is not null;
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_screen()->'clips') k where (k->>'id')::int = :clip_iee) = 1,
  'итоги показаны: зал видит ИЭЭ — 1');

\echo '--- ведущий поправляет'
select bz_host(:'th', 'member', jsonb_build_object('client', pg_temp.cid('tg:9005'), 'team', :iee)) is not null;
select pg_temp.ok((select team_src = 'host' and team_id = :iee from bz_clients where id = pg_temp.cid('tg:9005')), 'Лёшу перевели в ИЭЭ');
select pg_temp.ok(not exists(select 1 from bz_votes where client_id = pg_temp.cid('tg:9005')), '…его голос за клип ИЭЭ снят');
select pg_temp.ok(bz_host(:'th', 'clips', '{"items": [{"team": 1, "title": "x"}]}')->>'error' like '%Сбросить голоса%', 'список клипов не меняется, пока есть голоса');
select bz_host(:'th', 'captain', jsonb_build_object('team', :iee, 'client', pg_temp.cid('tg:9005'))) is not null;
select pg_temp.ok((select captain = pg_temp.cid('tg:9005') from bz_teams where id = :iee), 'ведущий назначил Лёшу жать за ИЭЭ');
select bz_host(:'th', 'unbind', jsonb_build_object('client', (select id from bz_clients where kind = 'web'))) is not null;
select pg_temp.ok((select roster_id is null from bz_clients where kind = 'web') and (select count(*) from bz_votes) = 2,
  'ведущий сбросил вход из браузера — голос снят');
select bz_register(9030, 'Настоящий Дима', null)->>'token' as td \gset
select pg_temp.ok(bz_login(:'td', 'Дмитриев Дмитрий', 'Э-12-22')->>'ok' = 'true', '…и настоящий Дмитрий вошёл со своего телефона');
select bz_host(:'th', 'kick', jsonb_build_object('client', (select id from bz_clients where kind = 'web'))) is not null;
select pg_temp.ok(not exists(select 1 from bz_clients where kind = 'web'), 'лишний вход из браузера убран');
select pg_temp.ok((bz_tick(:'tw', 0, null)->>'error') = 'auth', '…его телефон узнаёт, что вход сброшен');

\echo '--- переименование команд'
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ"]}') is not null;
select pg_temp.ok((select team_id is null from bz_clients where id = pg_temp.cid('tg:9030')), 'ИЭЭ убрали из команд — Дмитрий без команды');
select pg_temp.ok(bz_claim(:'td', :iee)->>'error' is not null, '…и кнопку не жмёт');
select bz_host(:'th', 'teams', '{"names": ["ГПИ","ИВТИ","ИГВИЭ","ИнЭИ","ИРЭ","ИТАЭ","ИЭВТ","ИЭТЭ","ИЭЭ","ЭнМИ"]}') is not null;
select pg_temp.ok((select team_id = :iee from bz_clients where id = pg_temp.cid('tg:9030')), 'вернули ИЭЭ — Дмитрий снова в ней по списку');
select bz_host(:'th', 'vote_reset') is not null;
select pg_temp.ok((select count(*) from bz_votes) = 0 and (select vote_status from bz_game) = 'off', 'голоса сброшены');
select pg_temp.ok(jsonb_array_length(bz_host(:'th', 'clips', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('team', :ire, 'title', 'Клип про ИРЭ'), jsonb_build_object('team', :ire, 'title', 'Второй клип ИРЭ'),
  jsonb_build_object('team', null, 'title', 'Клип профкома'))))->'clips') = 3, 'клипов может быть несколько у одного ПБ и без ПБ');

\echo '--- пульс без вопроса не гоняет состояние зря'
select bz_host(:'th', 'start') is not null;
select pg_temp.ok(not (bz_tick(:'td', (select v from bz_game), null) ? 'round'), 'идёт вопрос: зритель получает только версию');
select pg_temp.ok(bz_tick(:'tm', (select v from bz_game), null) ? 'round', '…а тот, кто жмёт, — полное состояние');

\echo '--- права'
set role anon;
do $$ begin perform public._bz_view(true, null); raise exception 'ПРОВАЛ: anon вызвал _bz_view'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public._bz_team_for('ire'); raise exception 'ПРОВАЛ: anon вызвал _bz_team_for'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.bz_votes; raise exception 'ПРОВАЛ: anon читает голоса'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.roster; raise exception 'ПРОВАЛ: anon читает список выезда'; exception when insufficient_privilege then null; end $$;
select pg_temp.ok(public.bz_vote('нет', 1)->>'code' = 'auth', 'anon: голос без входа — auth');
select pg_temp.ok(public.bz_login('нет', 'Иванова Мария', 'ЭР-01-25')->>'code' = 'auth', 'anon: вход по ФИО без телефона — auth');
reset role;
select bz_host(:'th', 'new_game') is not null;
delete from roster where fio_norm in (select norm_fio(x) from unnest(array['Иванова Мария Сергеевна', 'Петров Олег Игоревич', 'Смирнов Иван Петрович',
  'Кузнецов Алексей', 'Дмитриев Дмитрий', 'Сидорова Анна', 'Козлов Артём Ильич', 'Козлов Артём Олегович']) x);
\echo 'ГОТОВО v9 (вход по ФИО, голосование)'

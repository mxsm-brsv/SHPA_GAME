-- Проверка v9: профбюро участника (из списка выезда / сам / ведущий), кто жмёт кнопку, голосование за клипы.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;

\echo '--- подготовка: новая игра, список выезда'
select bz_host_login(setting_text('staff_code', ''), 'v9')->>'token' as th \gset
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
insert into roster (fio, fio_norm, grp, grp_norm, faction, tg_id)
values ('Иванова Мария Сергеевна', 'иванова мария сергеевна v9', 'ЭР-01-25', 'эр0125', 'ire', 9001),
       ('Петров Олег', 'петров олег v9', '', '', 'profkom', 9002);

\echo '--- профбюро из списка выезда'
select bz_register(9001, 'Маша', 'masha')->>'token' as tm \gset
select pg_temp.ok((select team_id = :ire and team_src = 'roster' and fio = 'Иванова Мария Сергеевна' from bz_clients where tg_id = 9001),
  'зарегистрированная в игре ШПА — сразу в ИРЭ, с ФИО');
select pg_temp.ok(bz_join(:'tm', :ivti)->>'error' like '%из списка выезда%', 'сменить профбюро из списка выезда нельзя');
select pg_temp.ok(bz_claim(:'tm', :ivti)->>'error' like '%только за свою%', 'жать кнопку за чужую команду нельзя');
select pg_temp.ok(bz_claim(:'tm', :ire)->>'ok' = 'true', 'за свою — можно');
select bz_register(9002, 'Олег', null)->>'token' as tp \gset
select pg_temp.ok((select team_id is null and team_src = 'roster' from bz_clients where tg_id = 9002), 'профком — без команды');
select pg_temp.ok(bz_claim(:'tp', :gpi)->>'error' like '%Организаторы%', 'организатор кнопку не жмёт');

\echo '--- выбрал сам'
select bz_register(9003, 'Ваня', null)->>'token' as ts \gset
select pg_temp.ok(bz_tick(:'ts', 0, null)->'me'->>'team' is null, 'без профбюро — телефон знает, что надо выбрать');
select pg_temp.ok(bz_join(:'ts', :ivti)->>'ok' = 'true', 'выбрал ИВТИ');
select pg_temp.ok((bz_tick(:'ts', 0, null)->'me'->>'can_change')::boolean, 'первые 10 минут можно передумать');
select pg_temp.ok(bz_join(:'ts', :gpi)->>'ok' = 'true', 'передумал: ГПИ');
update bz_clients set team_at = now() - interval '11 minutes' where tg_id = 9003;
select pg_temp.ok(bz_join(:'ts', :ivti)->>'error' like '%ведущий%', 'через 10 минут — только ведущий');
select pg_temp.ok(bz_claim(:'ts', :ivti)->>'error' like '%только за свою%', 'и кнопку за чужую команду не взять');
select pg_temp.ok(bz_claim(:'ts', :gpi)->>'ok' = 'true', 'за своё ГПИ — жмёт он');
select pg_temp.ok((bz_tick(:'ts', 0, null)->'me'->>'captain')::boolean, 'телефон знает, что жмёт он');
select bz_register(9005, 'Лёша', null)->>'token' as tl \gset
select bz_join(:'tl', :gpi) is not null;
select pg_temp.ok((select t->>'captain_name' from jsonb_array_elements(bz_tick(:'tl', 0, null)->'teams') t where (t->>'id')::int = :gpi) = 'Ваня',
  'товарищ по команде видит, кто жмёт');
select pg_temp.ok(bz_claim(:'tl', :gpi)->>'error' like '%уже жмёт Ваня%', 'второй за ту же команду не жмёт');
select pg_temp.ok((select (t->>'members')::int from jsonb_array_elements(bz_screen()->'teams') t where (t->>'id')::int = :gpi) = 2, 'в ГПИ двое');
select pg_temp.ok(jsonb_array_length(bz_tick(:'tl', 0, null)->'me'->'mates') = 2, 'Лёша видит двоих из своего ПБ');
select pg_temp.ok(bz_assign(:'tl', (select id from bz_clients where tg_id = 9005))->>'error' like '%передать её может только он%', 'Лёша не может отнять кнопку у Вани');
select pg_temp.ok(bz_assign(:'ts', (select id from bz_clients where tg_id = 9005))->>'ok' = 'true', 'Ваня передал кнопку Лёше');
select pg_temp.ok((bz_tick(:'tl', 0, null)->'me'->>'captain')::boolean, 'теперь жмёт Лёша');
select pg_temp.ok(bz_assign(:'tl', (select id from bz_clients where tg_id = 9001))->>'error' like '%не из твоего%', 'назначить человека из другого ПБ нельзя');
select pg_temp.ok(bz_assign(:'tl', (select id from bz_clients where tg_id = 9003))->>'ok' = 'true', 'Лёша вернул кнопку Ване');

\echo '--- голосование'
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'до открытия голосовать нельзя');
select bz_host(:'th', 'vote', '{"status": "open"}') is not null;
select pg_temp.ok(bz_vote(:'tl', :clip_gpi)->>'error' like '%твоего профбюро%', 'за клип своего профбюро нельзя');
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'ok' = 'true', 'Лёша (ГПИ) — за клип ИРЭ');
select pg_temp.ok((bz_vote(:'tl', :clip_iee)->'me'->>'vote')::int = :clip_iee, 'передумал — за ИЭЭ, телефон это видит');
select pg_temp.ok((select count(*) from bz_votes v join bz_clients c on c.id = v.client_id where c.tg_id = 9005) = 1, 'голос один');
select pg_temp.ok(bz_join(:'tl', :ire)->>'error' is not null, 'проголосовал — профбюро уже не сменить');
select pg_temp.ok(bz_vote(:'tm', :clip_ire)->>'error' like '%твоего%', 'Маша (ИРЭ из списка) за ИРЭ — нельзя');
select pg_temp.ok(bz_vote(:'tm', :clip_gpi)->>'ok' = 'true', 'Маша — за ГПИ');
select pg_temp.ok(bz_vote(:'tp', :clip_ire)->>'ok' = 'true', 'организатор (профком) — за любой клип');
select bz_register_web('browser-device-key-123456', 'Гость')->>'token' as tw \gset
select bz_join(:'tw', :iee) is not null;
select pg_temp.ok(bz_vote(:'tw', :clip_ire)->>'error' like '%Telegram%', 'из браузера по умолчанию не голосуют');
select bz_host(:'th', 'settings', '{"vote_web": true}') is not null;
select pg_temp.ok(bz_vote(:'tw', :clip_ire)->>'ok' = 'true', 'ведущий разрешил браузер — голос принят');
select bz_register(9006, 'Без профбюро', null)->>'token' as tn \gset
select pg_temp.ok(bz_vote(:'tn', :clip_ire)->>'error' like '%выбери своё профбюро%', 'без профбюро голосовать нельзя');
select bz_host(:'th', 'settings', '{"vote_roster_only": true}') is not null;
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%зарегистрированные%', 'режим «только список выезда»: сам выбравший не голосует');
select pg_temp.ok(bz_vote(:'tm', :clip_iee)->>'ok' = 'true', '…а из списка — голосует');
select bz_host(:'th', 'settings', '{"vote_roster_only": false}') is not null;

\echo '--- кто видит итоги'
select pg_temp.ok(not (bz_screen()->'clips'->0 ? 'votes') and (bz_screen()->'vote'->>'total')::int = 4, 'зал видит только число голосов (4), без раскладки');
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_host_state(:'th')->'clips') k where (k->>'id')::int = :clip_ire) = 2,
  'ведущий видит: за ИРЭ — 2');
select pg_temp.ok((select (k->>'roster')::int from jsonb_array_elements(bz_host_state(:'th')->'clips') k where (k->>'id')::int = :clip_ire) = 1,
  '…из них 1 — из списка выезда (профком)');
select pg_temp.ok(jsonb_array_length(bz_host_state(:'th')->'members') >= 6, 'ведущий видит всех вошедших');
select bz_host(:'th', 'vote', '{"status": "closed"}') is not null;
select pg_temp.ok(bz_vote(:'tl', :clip_ire)->>'error' like '%закрыто%', 'после закрытия голос не поменять');
select bz_host(:'th', 'vote', '{"status": "shown"}') is not null;
select pg_temp.ok((select (k->>'votes')::int from jsonb_array_elements(bz_screen()->'clips') k where (k->>'id')::int = :clip_iee) = 2,
  'итоги показаны: зал видит ИЭЭ — 2');

\echo '--- ведущий поправляет'
select bz_host(:'th', 'member', jsonb_build_object('client', (select id from bz_clients where tg_id = 9005), 'team', :iee)) is not null;
select pg_temp.ok((select team_src = 'host' and team_id = :iee from bz_clients where tg_id = 9005), 'Лёшу перевели в ИЭЭ');
select pg_temp.ok(not exists(select 1 from bz_votes v join bz_clients c on c.id = v.client_id where c.tg_id = 9005), '…его голос за клип ИЭЭ снят');
select pg_temp.ok(bz_host(:'th', 'clips', '{"items": [{"team": 1, "title": "x"}]}')->>'error' like '%Сбросить голоса%', 'список клипов не меняется, пока есть голоса');
select bz_host(:'th', 'captain', jsonb_build_object('team', :iee, 'client', (select id from bz_clients where tg_id = 9005))) is not null;
select pg_temp.ok((select captain = (select id from bz_clients where tg_id = 9005) from bz_teams where id = :iee), 'ведущий назначил Лёшу жать за ИЭЭ');
select bz_host(:'th', 'kick', jsonb_build_object('client', (select id from bz_clients where name = 'Гость'))) is not null;
select pg_temp.ok(not exists(select 1 from bz_clients where name = 'Гость') and (select count(*) from bz_votes) = 2, 'гостя из браузера убрали вместе с голосом');
select bz_host(:'th', 'vote_reset') is not null;
select pg_temp.ok((select count(*) from bz_votes) = 0 and (select vote_status from bz_game) = 'off', 'голоса сброшены');
select pg_temp.ok(jsonb_array_length(bz_host(:'th', 'clips', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('team', :ire, 'title', 'Клип про ИРЭ'), jsonb_build_object('team', :ire, 'title', 'Второй клип ИРЭ'),
  jsonb_build_object('team', null, 'title', 'Клип профкома'))))->'clips') = 3, 'клипов может быть несколько у одного ПБ и без ПБ');

\echo '--- список выезда подтягивается позже'
select bz_register(9004, 'Дима', null)->>'token' as td \gset
select bz_join(:'td', :ivti) is not null;
insert into roster (fio, fio_norm, grp, grp_norm, faction, tg_id) values ('Дмитрий Смирнов', 'дмитрий смирнов v9', '', '', 'iee', 9004);
select bz_tick(:'td', 0, null) is not null;
select pg_temp.ok((select team_id = :iee and team_src = 'roster' from bz_clients where tg_id = 9004), 'зарегистрировался в игре — профбюро исправилось на ИЭЭ из списка');

\echo '--- пульс без вопроса не гоняет состояние зря'
select bz_host(:'th', 'start') is not null;
select pg_temp.ok(not (bz_tick(:'td', (select v from bz_game), null) ? 'round'), 'идёт вопрос: зритель получает только версию');
select pg_temp.ok(bz_tick(:'tm', (select v from bz_game), null) ? 'round', '…а тот, кто жмёт, — полное состояние');

\echo '--- права'
set role anon;
do $$ begin perform public._bz_join(1, 1); raise exception 'ПРОВАЛ: anon вызвал _bz_join'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public._bz_roster_sync(1); raise exception 'ПРОВАЛ: anon вызвал _bz_roster_sync'; exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.bz_votes; raise exception 'ПРОВАЛ: anon читает голоса'; exception when insufficient_privilege then null; end $$;
select pg_temp.ok(public.bz_vote('нет', 1)->>'code' = 'auth', 'anon: голос без входа — auth');
reset role;
select bz_host(:'th', 'new_game') is not null;
\echo 'ГОТОВО v9 (голосование)'

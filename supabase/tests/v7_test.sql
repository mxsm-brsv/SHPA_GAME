-- Проверка миграции v7 (после v6_test.sql): кнопка админа сбрасывает всё, включая регистрации.
\set ON_ERROR_STOP 1
set test.role = '';
select id as admin_id from players where role = 'admin' and roster_id is not null limit 1 \gset
select id as p2 from players where faction = 'iee' and role = 'participant' and roster_id is not null limit 1 \gset
select roster_id as p2_roster from players where id = :'p2' \gset
\echo '--- до сброса: участник зарегистрирован с устройства и играет'
update roster set device_hash = 'dev-p2', bound_at = now() where id = :p2_roster;
select _grant_task(:'p2', 'bonus', 25, 'task', null, 'тест') as granted;
select _db_summary() - 'epoch' as before;
\echo '--- админ: СБРОС'
set test.uid = :'admin_id';
select admin_reset_progress('СБРОС') - 'epoch' as report;
select _db_summary() - 'epoch' as after;
\echo '--- старая сессия участника попадает на вход'
set test.uid = :'p2';
do $$ begin perform me(); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform save_progress('{"v":1}'::jsonb, 1, 1, setting_int('progress_epoch', 0)); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
\echo '--- входит заново с другого устройства (раньше бы не пустило) — тот же игрок, с нуля'
set test.uid = '';
select (roster_login((select fio from roster where id = :p2_roster), (select grp from roster where id = :p2_roster), null, null, 'dev-new', 'k-v7'))->>'ok' as login_ok;
select roster_attach(:p2_roster, :'p2');
set test.uid = :'p2';
select me()->>'rating' as rating_after_relogin, (me()->>'epoch')::int = setting_int('progress_epoch', 0) as epoch_ok;
select (select device_hash from roster where id = :p2_roster) = 'dev-new' as bound_to_new_device;
\echo 'ГОТОВО v7'

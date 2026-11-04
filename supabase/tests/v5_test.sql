-- Проверка миграции v5 (после v4_test.sql): «взять в работу», зоны дежурства, без двойных QR-отметок.
\set ON_ERROR_STOP 1
set test.role = '';
select id as admin_id from players where role = 'admin' limit 1 \gset
select id as org from players where role = 'staff' limit 1 \gset
select id as p2 from players where faction = 'iee' and role = 'participant' limit 1 \gset
\echo '--- две новые сдачи от участника'
set test.uid = :'p2';
select submit_task('meme', 'Мем про профбюро и сессию, очень смешной', null) is not null as s1;
select submit_task('history', repeat('История из жизни профбюро. ', 4), null) is not null as s2;
\echo '--- админ берёт в работу, орг видит, что занято'
set test.uid = :'admin_id';
select staff_claim(1) as admin_holds;
set test.uid = :'org';
select count(*) filter (where x->>'claimedBy' is not null and not (x->>'claimedMine')::boolean) as busy_for_org,
       count(*) filter (where x->>'claimedBy' is null) as free_for_org
  from jsonb_array_elements(staff_submissions()) x;
select (select (x->>'id')::bigint from jsonb_array_elements(staff_submissions()) x where x->>'claimedBy' is not null limit 1) as taken \gset
select set_config('my.taken', :'taken', false);
do $$ begin perform staff_review(current_setting('my.taken')::bigint, true, 10, null, 'x'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select staff_claim(5) as org_holds;
select staff_set_duty('mod', 'ИРЭ, ИЭЭ');
set test.uid = :'admin_id';
select staff_set_duty('qr', 'блок 2');
select jsonb_agg(jsonb_build_object('n', x->>'name', 'z', x->>'zone', 'h', x->>'holding')) as team from jsonb_array_elements(staff_team()) x;
select staff_review(:taken, true, 10, null, 'Мем')->>'ok' as admin_reviews_own;
select staff_release();
\echo '--- одна и та же отметка не открывается дважды'
set test.uid = :'org';
select staff_lecture_open('Блок 5: Право', 15, 10)->>'existing' as first_existing;
set test.uid = :'admin_id';
select staff_lecture_open('блок 5: право', 15, 10)->>'existing' as second_existing, staff_lecture_open('Блок 5: Право', 15, 10)->>'openedByName' as opened_by;
select count(*) as open_sessions from lectures where lower(title) = 'блок 5: право' and closes_at > now();
\echo 'ГОТОВО v5'

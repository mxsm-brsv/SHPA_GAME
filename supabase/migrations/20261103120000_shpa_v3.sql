-- ШПА v3: задания «Ты — лидер» с проверкой и уведомлениями «принято / не принято», квизы считает сервер,
-- QR-отметки трёх видов (блок, «Я — скорость», активность), свои вопросы участников и тесты по коду, загрузка банка функцией.

-- ---------- Задания ----------
alter table public.task_defs add column if not exists moderated boolean not null default false;
alter table public.task_defs add column if not exists min_text int;
alter table public.task_defs add column if not exists max_text int;
insert into public.task_defs (id, amount, lim, moderated, min_text, max_text) values
  ('lecture', 15, '30', false, null, null), ('speed_qr', 30, 'daily', false, null, null),
  ('likes', 10, 'daily', true, null, null), ('vk_comments', 10, 'daily', true, null, null), ('meme', 20, 'daily', true, null, null),
  ('history', 20, 'daily', true, null, null), ('morning', 40, 'daily', true, null, null), ('letter', 30, 'once', true, null, null),
  ('monument', 40, 'once', true, null, null), ('new_contest', 30, 'once', true, 200, 2000), ('new_merch', 30, 'once', true, null, null),
  ('stickers', 40, 'once', true, null, null), ('fashion', 30, 'once', true, null, null), ('edit', 50, 'once', true, null, null),
  ('photohunt', 30, 'once', true, null, null), ('cheese', 30, 'once', true, null, null), ('steps', 60, 'once', true, null, null),
  ('color_date', 30, 'once', true, null, null)
on conflict (id) do update set amount = excluded.amount, lim = excluded.lim, moderated = excluded.moderated, min_text = excluded.min_text, max_text = excluded.max_text;
update public.task_defs set moderated = true where id in ('vk_group', 'story', 'grant', 'brand', 'sponsor', 'press', 'photo', 'tg_channel');
update public.task_defs set lim = 'once' where id = 'invite';

alter table public.submissions add column if not exists note text;

/** Сколько ещё раз можно выполнить задание (0 — лимит исчерпан). */
create or replace function public._task_left(uid uuid, p_task text) returns int language sql stable security definer set search_path = public as $$
  select greatest(0, (case when t.lim in ('once', 'daily') then 1 else t.lim::int end) - (
    select count(*)::int from rating_log r where r.player_id = uid and r.source = t.id and r.kind in ('task', 'staff') and (t.lim <> 'daily' or r.day = msk_day())))
  from task_defs t where t.id = p_task
$$;

-- ---------- Уведомления ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  text text not null,
  kind text not null default 'info' check (kind in ('ok', 'bad', 'info')),
  submission_id bigint,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_player on public.notifications (player_id, created_at desc);
alter table public.notifications enable row level security;

create or replace function public._notify(uid uuid, p_text text, p_kind text, p_sub bigint default null) returns void language sql security definer set search_path = public as $$
  insert into notifications (player_id, text, kind, submission_id) values (uid, left(p_text, 500), p_kind, p_sub)
$$;

create or replace function public.my_notes() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id::text, 'text', n.text, 'kind', n.kind, 'at', ms(n.created_at), 'read', n.read_at is not null) order by n.created_at desc), '[]'::jsonb)
  from (select * from notifications where player_id = auth.uid() order by created_at desc limit 30) n
$$;

create or replace function public.notes_read(p_ids bigint[]) returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now() where player_id = auth.uid() and id = any (p_ids) and read_at is null
$$;

/** Состояние заданий с сервера: выполнено (ключ «задание@день» для ежедневных), на проверке, последние сдачи. */
create or replace function public.my_tasks() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return jsonb_build_object(
    'done', coalesce((select jsonb_object_agg(k, n) from (
      select case when t.lim = 'daily' then r.source || '@' || to_char(msk_day(), 'YYYY-MM-DD') else r.source end as k, count(*) as n
      from rating_log r join task_defs t on t.id = r.source
      where r.player_id = uid and r.kind in ('task', 'staff') and (t.lim <> 'daily' or r.day = msk_day()) group by 1) x), '{}'::jsonb),
    'pending', coalesce((select jsonb_object_agg(task, n) from (select task, count(*) as n from submissions where player_id = uid and status = 'pending' group by task) y), '{}'::jsonb),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'task', s.task, 'at', ms(s.created_at), 'status', s.status, 'rating', s.rating, 'note', s.note) order by s.created_at desc)
      from (select * from submissions where player_id = uid order by created_at desc limit 40) s), '[]'::jsonb));
end $$;

-- ---------- Сдача на проверку ----------
create or replace function public.submit_task(p_task text, p_text text, p_photo text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t task_defs; len int := length(btrim(coalesce(p_text, '')));
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into t from task_defs where id = p_task;
  if not found or not t.moderated then raise exception 'Это задание не сдаётся на проверку'; end if;
  if exists (select 1 from submissions where player_id = uid and task = p_task and status = 'pending') then raise exception 'Уже на проверке — дождись ответа'; end if;
  if _task_left(uid, p_task) <= 0 then raise exception 'Это задание уже засчитано'; end if;
  if (select count(*) from submissions where player_id = uid and created_at > now() - interval '1 day') >= 40 then raise exception 'Слишком много сдач за сутки'; end if;
  if t.min_text is not null and len < t.min_text then raise exception 'Нужно от % символов', t.min_text; end if;
  if t.max_text is not null and len > t.max_text then raise exception 'Не больше % символов', t.max_text; end if;
  if p_photo is null and len = 0 then raise exception 'Нужен текст, ссылка или фото'; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> uid::text then raise exception 'Чужое фото'; end if;
  insert into submissions (player_id, task, text, photo) values (uid, p_task, left(p_text, 4000), p_photo);
end $$;

drop function if exists public.staff_review(bigint, boolean, int);
create or replace function public.staff_review(p_id bigint, p_ok boolean, p_rating int, p_note text default null, p_title text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s submissions; g int := 0; title text; msg text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into s from submissions where id = p_id and status = 'pending' for update;
  if not found then return jsonb_build_object('ok', false); end if;
  title := coalesce(nullif(btrim(p_title), ''), s.task);
  if p_ok then g := _grant_task(s.player_id, s.task, greatest(0, least(coalesce(p_rating, 0), 500)), 'staff', auth.uid()); end if;
  update submissions set status = case when p_ok then 'approved' else 'rejected' end, rating = g, note = left(nullif(btrim(p_note), ''), 300),
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  msg := case when p_ok then '✅ Принято: «' || title || '» — +' || g || ' баллов' || coalesce('. ' || nullif(btrim(p_note), ''), '')
              else '❌ Не принято: «' || title || '»' || coalesce(' — ' || nullif(btrim(p_note), ''), '') || '. Можно сдать заново.' end;
  perform _notify(s.player_id, msg, case when p_ok then 'ok' else 'bad' end, p_id);
  return jsonb_build_object('ok', true, 'granted', g);
end $$;

create or replace function public.staff_submissions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'player', p.username, 'playerId', p.id, 'faction', p.faction, 'task', s.task,
    'text', s.text, 'photo', s.photo, 'at', ms(s.created_at), 'status', s.status, 'rating', s.rating, 'note', s.note) order by s.created_at)
    from submissions s join players p on p.id = s.player_id where s.status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.staff_grant(p_player uuid, p_amount int, p_task text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  g := _grant_task(p_player, coalesce(p_task, 'bonus'), greatest(0, least(p_amount, 500)), 'staff', auth.uid(), p_note);
  if g = 0 then raise exception 'Лимит этого задания у участника уже исчерпан'; end if;
  perform _notify(p_player, '⭐ Организатор начислил +' || g || ' баллов' || coalesce(': ' || nullif(btrim(p_note), ''), ''), 'ok');
  return jsonb_build_object('granted', g);
end $$;

/** Для edge-функции notify: текст уведомления по сдаче и Telegram получателя (только service role). */
create or replace function public.service_note_for(p_sub bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('text', n.text, 'tg', p.tg_id)
  from notifications n join players p on p.id = n.player_id
  where n.submission_id = p_sub and coalesce(auth.role(), '') = 'service_role' order by n.created_at desc limit 1
$$;

/** Для edge-функции check-sub: Telegram игрока и начисление после проверки подписки ботом (только service role). */
create or replace function public.service_player_tg(p_player uuid) returns bigint language sql stable security definer set search_path = public as $$
  select tg_id from players where id = p_player and coalesce(auth.role(), '') = 'service_role'
$$;
create or replace function public.service_grant_task(p_player uuid, p_task text) returns jsonb language plpgsql security definer set search_path = public as $$
declare g int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service only'; end if;
  g := _grant_task(p_player, p_task, (select amount from task_defs where id = p_task));
  if g > 0 then perform _notify(p_player, '✅ Подписка на канал подтверждена: +' || g || ' баллов', 'ok'); end if;
  return jsonb_build_object('granted', g, 'rating', (select rating from players where id = p_player));
end $$;

-- ---------- Квизы заданий: вопросы выбирает и проверяет сервер ----------
create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  task text not null,
  qids text[] not null,
  started_at timestamptz not null default now(),
  claimed boolean not null default false
);
alter table public.quiz_sessions enable row level security;

create or replace function public.quiz_start(p_task text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; ids text[]; sid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_task not in ('intro_quiz', 'docs_quiz') then raise exception 'Это не квиз'; end if;
  if _task_left(uid, p_task) <= 0 then raise exception 'Квиз уже засчитан'; end if;
  if (select count(*) from quiz_sessions where player_id = uid and started_at > now() - interval '1 hour') >= 20 then raise exception 'Слишком часто — попробуй позже'; end if;
  n := case when p_task = 'intro_quiz' then 10 else 3 end;
  select array_agg(id) into ids from (
    select id from question_pool()
    where p_task <> 'intro_quiz' or topic in ('Устав Профсоюза', 'Профсоюз: закон', 'Профсоюз: устройство и учёт', 'СКС Профсоюза')
    order by random() limit n) x;
  if ids is null then raise exception 'Нет вопросов'; end if;
  insert into quiz_sessions (player_id, task, qids) values (uid, p_task, ids) returning id into sid;
  return jsonb_build_object('id', sid::text, 'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'format', q.format, 'topic', q.topic, 'level', q.level,
    'question', q.question, 'options', q.options, 'source', q.source)) from questions q where q.id = any (ids)));
end $$;

drop function if exists public.claim_auto_task(text, int, text);
create or replace function public.claim_auto_task(p_task text, p_value int default null, p_text text default null, p_quiz text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); amount int; g int; r int; t task_defs; qs quiz_sessions; right_n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into t from task_defs where id = p_task;
  if p_task = 'case_day' then
    if not exists (select 1 from answers where player_id = uid and day = msk_day() and correct and question_id = case_of_day_id()) then
      raise exception 'Дело дня не решено';
    end if;
    if (select count(*) from answers where player_id = uid and day = msk_day() and question_id = case_of_day_id()) > 1 then
      return jsonb_build_object('granted', 0, 'rating', (select rating from players where id = uid));
    end if;
    amount := t.amount;
  elsif p_task in ('daily_login', 'profile', 'reflection') then
    amount := t.amount;
  elsif p_task in ('intro_quiz', 'docs_quiz') then
    -- считаем первый ответ на каждый выданный вопрос после старта квиза; присланное число не используется
    select * into qs from quiz_sessions where id = nullif(p_quiz, '')::uuid and player_id = uid and task = p_task and not claimed
      and started_at > now() - interval '40 minutes' for update;
    if not found then raise exception 'Квиз не найден или устарел — открой его заново'; end if;
    select count(*) into right_n from unnest(qs.qids) q(id)
      where (select a.correct from answers a where a.player_id = uid and a.question_id = q.id and a.created_at >= qs.started_at order by a.created_at limit 1);
    update quiz_sessions set claimed = true where id = qs.id;
    amount := t.amount * least(case when p_task = 'intro_quiz' then 10 else 3 end, right_n);
  elsif p_task = 'thought' then
    if length(btrim(coalesce(p_text, ''))) < 80 then raise exception 'Нужно хотя бы 80 символов'; end if;
    amount := t.amount;
  elsif p_task = 'tg_channel' then
    raise exception 'Подписку проверяет бот: кнопка «Проверить подписку» в Telegram или скриншот на проверку';
  else
    raise exception 'Это задание сдаётся по-другому';
  end if;
  g := _grant_task(uid, p_task, amount);
  if g > 0 and p_text is not null then
    insert into submissions (player_id, task, text, status, rating) values (uid, p_task, left(p_text, 4000), 'approved', g);
  end if;
  select rating into r from players where id = uid;
  return jsonb_build_object('granted', g, 'rating', r);
end $$;

-- ---------- QR-отметки: блок, «Я — скорость» (первые N, статичный код), своя активность ----------
alter table public.lectures add column if not exists kind text not null default 'lecture';
alter table public.lectures add column if not exists max_claims int not null default 0;
alter table public.lectures add column if not exists rotating boolean not null default true;
alter table public.lectures add column if not exists static_code text;
create unique index if not exists lectures_static_code on public.lectures (static_code) where static_code is not null;

create or replace function public.lecture_json(l public.lectures, with_secret boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'title', l.title, 'points', l.points, 'openedAt', ms(l.opened_at), 'closesAt', ms(l.closes_at),
    'kind', l.kind, 'maxClaims', l.max_claims, 'rotating', l.rotating,
    'claims', (select count(*) from lecture_claims c where c.lecture_id = l.id),
    'mine', exists (select 1 from lecture_claims c where c.lecture_id = l.id and c.player_id = auth.uid()))
    || case when with_secret then jsonb_strip_nulls(jsonb_build_object('secret', l.secret, 'code', l.static_code)) else '{}'::jsonb end
$$;

drop function if exists public.staff_lecture_open(text, int, int);
create or replace function public.staff_lecture_open(p_title text, p_points int, p_minutes int, p_kind text default 'lecture', p_max int default 0, p_rotating boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l lectures; k text := case when p_kind in ('lecture', 'speed', 'activity') then p_kind else 'lecture' end; rot boolean := coalesce(p_rotating, true); v_code text; i int := 0;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not rot then
    loop
      v_code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
      exit when not exists (select 1 from lectures where static_code = v_code);
      i := i + 1; if i > 20 then raise exception 'Не получилось придумать код'; end if;
    end loop;
  end if;
  insert into lectures (id, title, points, secret, closes_at, opened_by, kind, max_claims, rotating, static_code)
  values (substr(md5(random()::text), 1, 10), left(coalesce(nullif(btrim(p_title), ''), 'Блок'), 80), least(50, greatest(1, coalesce(p_points, 15))),
    encode(extensions.gen_random_bytes(16), 'hex'), now() + make_interval(mins => least(case when rot then 180 else 1440 end, greatest(1, coalesce(p_minutes, 7)))), auth.uid(),
    k, least(500, greatest(0, coalesce(p_max, 0))), rot, v_code)
  returning * into l;
  return lecture_json(l, true);
end $$;

create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); v_raw text := upper(btrim(coalesce(p_code, ''))); eg egg_codes; ca cache_codes; other players; me players;
  g int := 0; msg text; n int; v_a uuid; v_b uuid; sc record; l lectures; slot bigint := floor(extract(epoch from now()) / 20); same int; task text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  -- пасхалки
  select * into eg from egg_codes where egg_codes.code = v_raw;
  if found then
    if exists (select 1 from egg_redeems where player_id = uid and egg_redeems.code = eg.code) then msg := 'Эту пасхалку ты уже нашёл';
    else
      g := _grant_task(uid, eg.task, eg.rating);
      if g > 0 then insert into egg_redeems (player_id, code) values (uid, eg.code); msg := 'Пасхалка! +' || g || ' баллов';
      else msg := 'Лимит по этому заданию исчерпан'; end if;
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  -- тайники
  select * into ca from cache_codes where cache_codes.code = v_raw;
  if found then
    if ca.gold then
      if exists (select 1 from cache_finds where cache_finds.code = ca.code) then msg := 'Золотой тайник уже нашли до тебя';
      else insert into cache_finds (player_id, code) values (uid, ca.code); g := _grant_task(uid, 'cache_gold', 100); msg := 'ЗОЛОТОЙ ТАЙНИК! +' || g; end if;
    elsif exists (select 1 from cache_finds where player_id = uid and cache_finds.code = ca.code) then msg := 'Тайник №' || ca.n || ' уже найден';
    else
      insert into cache_finds (player_id, code) values (uid, ca.code);
      g := _grant_task(uid, 'caches', 15);
      select count(*) into n from cache_finds cf join cache_codes cc on cc.code = cf.code where cf.player_id = uid and not cc.gold;
      if n = 10 then g := g + _grant_task(uid, 'bonus', 50, 'task', null, 'все 10 тайников'); end if;
      msg := 'Тайник №' || ca.n || ': +' || g || ' баллов';
    end if;
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
  end if;
  select * into sc from parse_scan(p_code);
  -- QR-отметка: обновляемый код (текущий или предыдущий слот) или статичный код
  if sc.kind <> 'person' then
    select * into l from lectures where closes_at > now()
      and ((rotating and (rot_code(secret, slot) = sc.code or rot_code(secret, slot - 1) = sc.code)) or (not rotating and static_code = sc.code))
      limit 1 for update;
    if found then
      if exists (select 1 from lecture_claims where lecture_id = l.id and player_id = uid) then
        return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Здесь («' || l.title || '») ты уже отмечен', 'lecture', l.id);
      end if;
      if l.max_claims > 0 and (select count(*) from lecture_claims where lecture_id = l.id) >= l.max_claims then
        return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Опоздал: баллы уже забрали первые ' || l.max_claims);
      end if;
      task := case l.kind when 'speed' then 'speed_qr' when 'activity' then 'bonus' else 'lecture' end;
      if task <> 'bonus' and _task_left(uid, task) <= 0 then
        return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', case when task = 'speed_qr' then '«Я — скорость» сегодня уже засчитано' else 'Лимит отметок исчерпан' end);
      end if;
      insert into lecture_claims (lecture_id, player_id) values (l.id, uid);
      g := _grant_task(uid, task, l.points, 'task', null, case when task = 'bonus' then 'отметка: ' || l.title end);
      -- бонус ПБ за блок: 5+ человек одного ПБ → +10 влияния (один раз на блок)
      if l.kind = 'lecture' and me.role = 'participant' and not (me.faction = any (l.bonus_given)) then
        select count(*) into same from lecture_claims c join players p on p.id = c.player_id where c.lecture_id = l.id and p.faction = me.faction;
        if same >= 5 then
          update faction_world set influence = influence + 10 where faction = me.faction;
          update lectures set bonus_given = bonus_given || me.faction where id = l.id;
        end if;
      end if;
      return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', 'Отметка «' || l.title || '»: +' || g || ' баллов', 'lecture', l.id);
    end if;
    if sc.kind = 'lecture' then raise exception 'Код устарел или отметка закрыта. Отсканируй QR у организатора ещё раз.'; end if;
  end if;
  -- знакомство по личному QR
  select * into other from players where id = player_by_code(sc.code);
  if found then
    if other.id = uid then raise exception 'Это твой собственный код'; end if;
    v_a := least(uid, other.id); v_b := greatest(uid, other.id);
    if exists (select 1 from meets where meets.a = v_a and meets.b = v_b) then raise exception 'С этим человеком вы уже знакомы'; end if;
    insert into meets (a, b, by_player) values (v_a, v_b, uid);
    g := _grant_task(uid, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end);
    if g = 0 then raise exception 'На сегодня лимит знакомств — 20'; end if;
    perform _grant_task(other.id, 'meet', case when other.faction is distinct from me.faction then 10 else 5 end);
    return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', 'Знакомство с ' || other.username || ': +' || g);
  end if;
  raise exception 'Код не подошёл. Коды QR живут 20–30 секунд — попроси показать свежий.';
end $$;

-- ---------- Свои вопросы участников ----------
create table if not exists public.user_questions (
  id bigint generated always as identity primary key,
  player_id uuid references public.players(id) on delete set null,
  author text,
  q jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
alter table public.user_questions enable row level security;

create or replace function public.suggest_question(p_q jsonb) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); f text := p_q->>'format'; txt text := btrim(coalesce(p_q->>'question', '')); n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from user_questions where player_id = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'Не больше 20 вопросов в сутки'; end if;
  if f not in ('yesno', 'choice', 'input') then raise exception 'Неизвестный формат'; end if;
  if length(txt) < 10 or length(txt) > 500 then raise exception 'Вопрос — от 10 до 500 символов'; end if;
  if f = 'yesno' and jsonb_typeof(p_q->'correct') <> 'boolean' then raise exception 'Нет ответа'; end if;
  if f = 'choice' then
    n := coalesce(jsonb_array_length(p_q->'options'), 0);
    if n < 2 or n > 6 or jsonb_typeof(p_q->'correct') <> 'number' or (p_q->>'correct')::int not between 0 and n - 1 then raise exception 'Варианты ответа заполнены неверно'; end if;
  end if;
  if f = 'input' and length(btrim(coalesce(p_q->>'answer', ''))) = 0 then raise exception 'Нет ответа'; end if;
  insert into user_questions (player_id, author, q)
  values (uid, (select username from players where id = uid), jsonb_build_object('format', f, 'topic', left(coalesce(p_q->>'topic', 'Вопросы участников'), 80), 'question', txt,
    'options', p_q->'options', 'correct', p_q->'correct', 'answer', left(p_q->>'answer', 100), 'accepted', p_q->'accepted', 'explanation', left(coalesce(p_q->>'explanation', ''), 400)));
end $$;

create or replace function public.staff_questions() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(u.q || jsonb_build_object('id', u.id::text, 'status', u.status, 'author', u.author, 'at', ms(u.created_at), 'level', 2, 'source', '') order by u.created_at desc)
    from (select * from user_questions where status = 'pending' or created_at > now() - interval '2 days' order by created_at desc limit 100) u), '[]'::jsonb);
end $$;

create or replace function public.staff_question_review(p_id bigint, p_ok boolean) returns void language plpgsql security definer set search_path = public as $$
declare u user_questions; q jsonb;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into u from user_questions where id = p_id and status = 'pending' for update;
  if not found then return; end if;
  update user_questions set status = case when p_ok then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if not p_ok then return; end if;
  q := u.q;
  insert into questions (id, format, topic, level, question, options, correct_bool, correct_index, answer, accepted, explanation, source, approved, active)
  values ('u_' || u.id, q->>'format', q->>'topic', 2, q->>'question',
    case when q->>'format' = 'choice' then q->'options' end,
    case when q->>'format' = 'yesno' then (q->>'correct')::boolean end,
    case when q->>'format' = 'choice' then (q->>'correct')::int end,
    case when q->>'format' = 'input' then q->>'answer' end,
    case when q->>'format' = 'input' and jsonb_typeof(q->'accepted') = 'array' then array(select jsonb_array_elements_text(q->'accepted')) end,
    coalesce(q->>'explanation', ''), 'Вопрос участника (' || coalesce(u.author, '') || ')', true, true)
  on conflict (id) do nothing;
  if u.player_id is not null then perform _notify(u.player_id, '✅ Твой вопрос добавлен в общий банк: «' || left(q->>'question', 80) || '»', 'ok'); end if;
end $$;

-- ---------- Тесты по коду ----------
create table if not exists public.shared_tests (
  code text primary key,
  author_id uuid references public.players(id) on delete set null,
  spec jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.shared_tests enable row level security;

create or replace function public.share_test(p_spec jsonb) returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_code text; i int := 0;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if octet_length(p_spec::text) > 60000 then raise exception 'Тест слишком большой'; end if;
  if jsonb_typeof(p_spec->'ids') <> 'array' or jsonb_array_length(p_spec->'ids') = 0 or jsonb_array_length(p_spec->'ids') > 100 then raise exception 'В тесте должно быть от 1 до 100 вопросов'; end if;
  if (select count(*) from shared_tests where author_id = uid and created_at > now() - interval '1 day') >= 30 then raise exception 'Не больше 30 тестов в сутки'; end if;
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from shared_tests t where t.code = v_code);
    i := i + 1; if i > 20 then raise exception 'Не получилось придумать код'; end if;
  end loop;
  insert into shared_tests (code, author_id, spec) values (v_code, uid, jsonb_build_object(
    'name', left(coalesce(p_spec->>'name', 'Тест'), 60), 'ids', p_spec->'ids', 'extra', coalesce(p_spec->'extra', '[]'::jsonb),
    'timer', least(120, greatest(0, coalesce((p_spec->>'timer')::int, 0))), 'author', left(coalesce(p_spec->>'author', (select username from players where id = uid)), 60)));
  return v_code;
end $$;

create or replace function public.get_shared_test(p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select spec || jsonb_build_object('code', code, 'created', ms(created_at)) from shared_tests where code = upper(btrim(p_code))
$$;

-- ---------- Банк вопросов: загрузка из GitHub Actions (service role) ----------
create or replace function public.seed_questions(p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service only'; end if;
  insert into questions (id, format, topic, level, question, options, correct_bool, correct_index, answer, accepted, explanation, source, active, updated_at)
  select r->>'id', r->>'format', r->>'topic', coalesce((r->>'level')::int, 1), r->>'question',
    case when r->>'format' = 'choice' then r->'options' end,
    case when r->>'format' = 'yesno' then (r->>'correct')::boolean end,
    case when r->>'format' = 'choice' then (r->>'correct')::int end,
    case when r->>'format' = 'input' then r->>'answer' end,
    case when jsonb_typeof(r->'accepted') = 'array' then array(select jsonb_array_elements_text(r->'accepted')) end,
    coalesce(r->>'explanation', ''), coalesce(r->>'source', ''), true, now()
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set format = excluded.format, topic = excluded.topic, level = excluded.level, question = excluded.question, options = excluded.options,
    correct_bool = excluded.correct_bool, correct_index = excluded.correct_index, answer = excluded.answer, accepted = excluded.accepted,
    explanation = excluded.explanation, source = excluded.source, active = true, updated_at = now();
  get diagnostics n = row_count;
  -- вопросов, которых больше нет в файле, — выключаем (кроме принятых вопросов участников)
  update questions set active = false where id not like 'u\_%' and id not in (select r->>'id' from jsonb_array_elements(p_rows) r);
  return n;
end $$;

-- ---------- Права ----------
revoke all on function public._task_left(uuid, text), public._notify(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.my_notes(), public.notes_read(bigint[]), public.my_tasks(), public.submit_task(text, text, text),
  public.staff_review(bigint, boolean, int, text, text), public.staff_submissions(), public.staff_grant(uuid, int, text, text),
  public.service_note_for(bigint), public.service_player_tg(uuid), public.service_grant_task(uuid, text),
  public.quiz_start(text), public.claim_auto_task(text, int, text, text), public.lecture_json(public.lectures, boolean),
  public.staff_lecture_open(text, int, int, text, int, boolean), public.redeem_code(text),
  public.suggest_question(jsonb), public.staff_questions(), public.staff_question_review(bigint, boolean),
  public.share_test(jsonb), public.get_shared_test(text), public.seed_questions(jsonb) from public, anon, authenticated;
grant execute on function public.get_shared_test(text) to anon, authenticated;
grant execute on function
  public.my_notes(), public.notes_read(bigint[]), public.my_tasks(), public.submit_task(text, text, text),
  public.staff_review(bigint, boolean, int, text, text), public.staff_submissions(), public.staff_grant(uuid, int, text, text),
  public.quiz_start(text), public.claim_auto_task(text, int, text, text),
  public.staff_lecture_open(text, int, int, text, int, boolean), public.redeem_code(text),
  public.suggest_question(jsonb), public.staff_questions(), public.staff_question_review(bigint, boolean), public.share_test(jsonb)
to authenticated;
grant execute on function public.service_note_for(bigint), public.service_player_tg(uuid), public.service_grant_task(uuid, text), public.seed_questions(jsonb) to service_role;

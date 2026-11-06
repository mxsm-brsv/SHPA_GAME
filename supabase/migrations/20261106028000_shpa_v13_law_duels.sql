-- v13 (6 ноября): поединки в правовухе между участниками («Правовой ринг» → «Поединок»).
-- Один бросает вызов (код, ссылка в Telegram или открытый вызов для всех), второй принимает. Оба отвечают
-- на одни и те же 7 вопросов «да/нет» и «выбери ответ»; проверяет сервер. Побеждает тот, у кого больше верных,
-- при равенстве — кто быстрее. Можно отвечать одновременно (видно, как идёт соперник) или по очереди.
-- Имя файла — между v12 (20261106027000) и миграцией вечерки (20261106030000 в ветке vecherka).

create table if not exists public.law_duels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  qids text[] not null,
  a uuid not null references public.players(id) on delete cascade,
  b uuid references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  a_start timestamptz, a_end timestamptz,
  b_start timestamptz, b_end timestamptz,
  told boolean not null default false
);
create index if not exists law_duels_open on public.law_duels (created_at desc) where b is null;
create table if not exists public.law_duel_answers (
  duel uuid not null references public.law_duels(id) on delete cascade,
  player uuid not null references public.players(id) on delete cascade,
  qid text not null,
  ok boolean not null,
  at timestamptz not null default now(),
  primary key (duel, player, qid)
);
alter table public.law_duels enable row level security;
alter table public.law_duel_answers enable row level security;

/** Тот же разбор ответа, что в check_answer, но без записи в общую статистику. */
create or replace function public._answer_ok(q public.questions, p_answer text) returns boolean language plpgsql immutable set search_path = public, extensions as $$
declare g text := norm(p_answer); a text;
begin
  if q.format = 'yesno' then return p_answer = case when q.correct_bool then 'true' else 'false' end; end if;
  if q.format = 'choice' then return p_answer = q.correct_index::text; end if;
  foreach a in array (array[q.answer] || coalesce(q.accepted, '{}'::text[])) loop
    a := norm(a);
    if length(g) > 0 and (a = g or (length(a) > 5 and length(g) >= length(a) - 1 and extensions.levenshtein(a, g) <= 1)) then return true; end if;
  end loop;
  return false;
end $$;

/** Итог поединка для игрока uid: счёт, время, победитель. */
create or replace function public._duel_json(d public.law_duels, uid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me text := case when d.a = uid then 'a' when d.b = uid then 'b' end; ar int; br int; aa int; ba int; ams int; bms int; w text; opp uuid; o players;
begin
  select count(*) filter (where ok), count(*) into ar, aa from law_duel_answers where duel = d.id and player = d.a;
  select count(*) filter (where ok), count(*) into br, ba from law_duel_answers where duel = d.id and player = d.b;
  ams := case when d.a_end is not null then (extract(epoch from d.a_end - d.a_start) * 1000)::int end;
  bms := case when d.b_end is not null then (extract(epoch from d.b_end - d.b_start) * 1000)::int end;
  if d.a_end is not null and d.b_end is not null then
    w := case when ar > br then 'a' when br > ar then 'b' when ams < bms then 'a' when bms < ams then 'b' else 'draw' end;
  end if;
  opp := case when me = 'a' then d.b else d.a end;
  select * into o from players where id = opp;
  return jsonb_build_object('id', d.id, 'code', d.code, 'n', array_length(d.qids, 1), 'qids', case when me is not null then to_jsonb(d.qids) end,
    'created', ms(d.created_at), 'me', me,
    'my', jsonb_build_object('answered', case when me = 'a' then aa else ba end, 'right', case when me = 'a' then ar else br end,
      'started', case when me = 'a' then d.a_start is not null else d.b_start is not null end,
      'done', case when me = 'a' then d.a_end is not null else d.b_end is not null end, 'ms', case when me = 'a' then ams else bms end),
    'opp', case when opp is not null then jsonb_build_object('name', o.username, 'faction', o.faction,
      'answered', case when me = 'a' then ba else aa end,
      -- верные соперника видно только после того, как сам закончил, — чтобы не подсматривать
      'right', case when (me = 'a' and d.a_end is not null) or (me = 'b' and d.b_end is not null) then case when me = 'a' then br else ar end end,
      'done', case when me = 'a' then d.b_end is not null else d.a_end is not null end, 'ms', case when me = 'a' then bms else ams end) end,
    'result', case when w is null then null when w = 'draw' then 'draw' when w = me then 'win' else 'loss' end,
    'score', case when w is not null then jsonb_build_array(case when me = 'a' then ar else br end, case when me = 'a' then br else ar end) end);
end $$;
revoke all on function public._duel_json(public.law_duels, uuid) from public, anon, authenticated;

create or replace function public._duel_player() returns players language plpgsql stable security definer set search_path = public as $$
declare p players;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = auth.uid();
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  return p;
end $$;
revoke all on function public._duel_player() from public, anon, authenticated;

/** Бросить вызов: 7 случайных вопросов, код из 5 символов. */
create or replace function public.law_duel_create() returns jsonb language plpgsql security definer set search_path = public as $$
declare p players := _duel_player(); ids text[]; c text; i int := 0; d law_duels;
begin
  if (select count(*) from law_duels where a = p.id and b is null and created_at > now() - interval '3 hours') >= 3 then
    raise exception 'У тебя уже 3 вызова без соперника — дождись, пока их примут';
  end if;
  if (select count(*) from law_duels where (a = p.id or b = p.id) and created_at > now() - interval '1 day') >= 40 then raise exception 'На сегодня поединков хватит'; end if;
  select array_agg(id) into ids from (select id from question_pool() where format in ('yesno', 'choice') order by random() limit 7) x;
  if coalesce(array_length(ids, 1), 0) < 7 then raise exception 'Нет вопросов'; end if;
  loop
    c := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 5));
    exit when not exists (select 1 from law_duels where code = c);
    i := i + 1; if i > 20 then raise exception 'Не получилось придумать код'; end if;
  end loop;
  insert into law_duels (code, qids, a) values (c, ids, p.id) returning * into d;
  return _duel_json(d, p.id);
end $$;

/** Принять вызов по коду (или открыть свой поединок по коду). */
create or replace function public.law_duel_join(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare p players := _duel_player(); d law_duels; c text := code_clean(p_code);
begin
  select * into d from law_duels where code = c for update;
  if not found or d.created_at < now() - interval '12 hours' then raise exception 'Вызов не найден или устарел — проверь код'; end if;
  if d.a = p.id or d.b = p.id then return _duel_json(d, p.id); end if;
  if d.b is not null then raise exception 'Этот вызов уже принял другой участник'; end if;
  update law_duels set b = p.id where id = d.id returning * into d;
  perform _notify(d.a, p.username || ' принял твой вызов в правовом поединке — заходи в «Правовой ринг»', 'info');
  return _duel_json(d, p.id);
end $$;

/** Начать отвечать: с этого момента идёт время игрока. */
create or replace function public.law_duel_start(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare p players := _duel_player(); d law_duels;
begin
  select * into d from law_duels where id = p_id for update;
  if not found or (d.a <> p.id and d.b is distinct from p.id) then raise exception 'Поединок не найден'; end if;
  if d.a = p.id and d.a_start is null then update law_duels set a_start = now() where id = d.id returning * into d; end if;
  if d.b = p.id and d.b_start is null then update law_duels set b_start = now() where id = d.id returning * into d; end if;
  return _duel_json(d, p.id);
end $$;

/** Ответ на вопрос поединка. На все 7 — не больше 4 минут; '__timeout__' — время на вопрос вышло. */
create or replace function public.law_duel_answer(p_id uuid, p_qid text, p_answer text) returns jsonb language plpgsql security definer set search_path = public as $$
declare p players := _duel_player(); d law_duels; q questions; ok boolean; st timestamptz; n int; res jsonb; me text;
begin
  select * into d from law_duels where id = p_id for update;
  if not found or (d.a <> p.id and d.b is distinct from p.id) then raise exception 'Поединок не найден'; end if;
  me := case when d.a = p.id then 'a' else 'b' end;
  st := case when me = 'a' then d.a_start else d.b_start end;
  if st is null then raise exception 'Сначала начни поединок'; end if;
  if (me = 'a' and d.a_end is not null) or (me = 'b' and d.b_end is not null) then raise exception 'Ты уже ответил на все вопросы'; end if;
  if not (p_qid = any (d.qids)) then raise exception 'Это вопрос не из поединка'; end if;
  if exists (select 1 from law_duel_answers where duel = d.id and player = p.id and qid = p_qid) then raise exception 'На этот вопрос уже ответил'; end if;
  select * into q from questions where id = p_qid;
  ok := p_answer <> '__timeout__' and now() < st + interval '4 minutes' and _answer_ok(q, p_answer);
  insert into law_duel_answers (duel, player, qid, ok) values (d.id, p.id, p_qid, ok);
  select count(*) into n from law_duel_answers where duel = d.id and player = p.id;
  if n >= array_length(d.qids, 1) then
    if me = 'a' then update law_duels set a_end = now() where id = d.id returning * into d;
    else update law_duels set b_end = now() where id = d.id returning * into d; end if;
  end if;
  res := _duel_json(d, p.id);
  -- оба закончили — итог обоим (и в бота)
  if d.a_end is not null and d.b_end is not null and not d.told then
    update law_duels set told = true where id = d.id;
    perform _notify(d.a, _duel_note(d, d.a), 'info');
    perform _notify(d.b, _duel_note(d, d.b), 'info');
  end if;
  return jsonb_build_object('correct', ok, 'right', right_answer(q), 'explanation', q.explanation, 'duel', res);
end $$;

create or replace function public._duel_note(d public.law_duels, uid uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare j jsonb := _duel_json(d, uid);
begin
  return 'Правовой поединок с ' || coalesce(j->'opp'->>'name', 'соперником') || ': ' ||
    case j->>'result' when 'win' then 'победа' when 'loss' then 'поражение' else 'ничья' end || ' ' || (j->'score'->>0) || ':' || (j->'score'->>1);
end $$;
revoke all on function public._duel_note(public.law_duels, uuid) from public, anon, authenticated;

create or replace function public.law_duel_state(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p players := _duel_player(); d law_duels;
begin
  select * into d from law_duels where id = p_id;
  if not found or (d.a <> p.id and d.b is distinct from p.id) then raise exception 'Поединок не найден'; end if;
  return _duel_json(d, p.id);
end $$;

/** Мои поединки, открытые вызовы других и лучшие поединщики. */
create or replace function public.law_duel_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p players := _duel_player();
begin
  return jsonb_build_object(
    'mine', (select coalesce(jsonb_agg(_duel_json(d, p.id) order by d.created_at desc), '[]'::jsonb)
             from (select * from law_duels where (a = p.id or b = p.id) and created_at > now() - interval '2 days' order by created_at desc limit 15) d),
    'open', (select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name', x.username, 'faction', x.faction, 'created', ms(d.created_at),
               'right', case when d.a_end is not null then (select count(*) from law_duel_answers where duel = d.id and player = d.a and ok) end) order by d.created_at desc), '[]'::jsonb)
             from (select * from law_duels where b is null and a <> p.id and created_at > now() - interval '3 hours' order by created_at desc limit 15) d
             join players x on x.id = d.a),
    'board', (select coalesce(jsonb_agg(jsonb_build_object('name', t.username, 'faction', t.faction, 'wins', t.wins, 'played', t.played) order by t.wins desc, t.played), '[]'::jsonb)
              from (select pl.username, pl.faction, count(*) filter (where r.res = 'win') wins, count(*) played
                    from (select x.uid, _duel_json(d, x.uid)->>'result' res
                          from law_duels d cross join lateral (values (d.a), (d.b)) x(uid)
                          where d.a_end is not null and d.b_end is not null) r
                    join players pl on pl.id = r.uid group by pl.id, pl.username, pl.faction
                    order by wins desc, played limit 10) t where t.wins > 0));
end $$;

revoke execute on function public.law_duel_create(), public.law_duel_join(text), public.law_duel_start(uuid), public.law_duel_answer(uuid, text, text), public.law_duel_state(uuid), public.law_duel_list() from public, anon;
grant execute on function public.law_duel_create(), public.law_duel_join(text), public.law_duel_start(uuid), public.law_duel_answer(uuid, text, text), public.law_duel_state(uuid), public.law_duel_list() to authenticated;

-- Полный сброс чистит и поединки
create or replace function public._reset_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := _reset_progress();
  n := _reset_registrations();
  delete from vote_ballots where true;
  delete from vote_members where true;
  update vote_poll set round = round + 1, status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  delete from raid_hits where true;
  delete from raid_progress where true;
  update raid_world set holder = null, held_at = null where id = 1;
  delete from settings where key = 'casino_reveal';
  delete from law_duels where true;
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

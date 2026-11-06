-- v12 (6 ноября, день): голосование на блоке «Работа со спонсорами» — команды не по профбюро.
-- Названия любые; команды собирают сами организаторы (люди из разных ПБ и из одного). В игре человек вписывает
-- ФИО (сверка со списком выезда, как при входе) и выбирает команду — можно записать и товарища без телефона.
-- Каждый видит свою команду и её состав, за свою команду голосовать нельзя. Голос — ✅ или ❌.
-- Имя файла — между v11 (20261106025000) и миграцией вечерки (20261106030000 в ветке vecherka).

create table if not exists public.vote_members (
  round int not null,
  roster_id bigint not null references public.roster(id) on delete cascade,
  team text not null,
  primary key (round, roster_id)
);
alter table public.vote_members enable row level security;

/** Короткое название профбюро по-русски. */
create or replace function public._fshort(f text) returns text language sql immutable as $$
  select case f when 'inei' then 'ИнЭИ' when 'ire' then 'ИРЭ' when 'gpi' then 'ГПИ' when 'igvie' then 'ИГВИЭ' when 'ievt' then 'ИЭВТ'
    when 'iete' then 'ИЭТЭ' when 'enmi' then 'ЭнМИ' when 'itae' then 'ИТАЭ' when 'ivti' then 'ИВТИ' when 'iee' then 'ИЭЭ' else null end
$$;

/** Команда игрока в текущем голосовании (по строке списка выезда). */
create or replace function public._vote_my_team(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select m.team from vote_members m join players p on p.roster_id = m.roster_id join vote_poll v on v.id = 1
  where p.id = uid and m.round = v.round
$$;

create or replace function public.vote_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v vote_poll; uid uuid := auth.uid(); my jsonb; t jsonb; myf text; mt text; mates jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into v from vote_poll where id = 1;
  select faction into myf from players where id = uid;
  mt := _vote_my_team(uid);
  -- состав своей команды — чтобы найти друг друга (имена других команд участникам не отдаются)
  if mt is not null then
    select coalesce(jsonb_agg(_roster_short(r.fio) || coalesce(' · ' || _fshort(r.faction), '') order by r.fio), '[]'::jsonb) into mates
    from vote_members m join roster r on r.id = m.roster_id where m.round = v.round and m.team = mt;
  end if;
  select coalesce(jsonb_object_agg(team, b.v), '{}'::jsonb) into my from vote_ballots b where b.round = v.round and b.player_id = uid;
  select coalesce(jsonb_agg(x.j || jsonb_build_object(
      'za', (select count(*) from vote_ballots b where b.round = v.round and b.team = x.j->>'id' and b.v = 1),
      'protiv', (select count(*) from vote_ballots b where b.round = v.round and b.team = x.j->>'id' and b.v = -1),
      'size', (select count(*) from vote_members m where m.round = v.round and m.team = x.j->>'id')) order by x.n), '[]'::jsonb)
    into t from jsonb_array_elements(v.teams) with ordinality x(j, n);
  return jsonb_build_object('round', v.round, 'title', v.title, 'status', v.status, 'current', v.current, 'reveal', v.reveal,
    'teams', t, 'my', my, 'myFaction', myf, 'myTeam', mt, 'mates', coalesce(mates, '[]'::jsonb),
    'voters', (select count(distinct player_id) from vote_ballots b where b.round = v.round),
    'at', ms(v.updated_at));
end $$;

create or replace function public.vote_cast(p_team text, p_v int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v vote_poll; uid uuid := auth.uid(); p players; tm jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  select * into v from vote_poll where id = 1;
  if v.status <> 'open' then raise exception 'Голосование сейчас закрыто'; end if;
  if v.current is not null and v.current <> p_team then raise exception 'Сейчас голосуем за другую команду'; end if;
  select j into tm from jsonb_array_elements(v.teams) j where j->>'id' = p_team;
  if tm is null then raise exception 'Нет такой команды'; end if;
  if _vote_my_team(uid) = p_team or (nullif(tm->>'faction', '') is not null and tm->>'faction' = p.faction) then
    raise exception 'За свою команду голосовать нельзя';
  end if;
  if coalesce(p_v, 0) = 0 then
    delete from vote_ballots where round = v.round and team = p_team and player_id = uid;
  else
    insert into vote_ballots (round, team, player_id, v) values (v.round, p_team, uid, case when p_v > 0 then 1 else -1 end)
      on conflict (round, team, player_id) do update set v = excluded.v, at = now();
  end if;
  return vote_state();
end $$;

/** Организатор: название и команды. Голоса обнуляются; распределение по командам с теми же номерами сохраняется. */
create or replace function public.staff_vote_setup(p_title text, p_teams jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare t jsonb; old int; nw int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', left(x->>'id', 24), 'name', left(btrim(x->>'name'), 40),
      'faction', case when x->>'faction' in ('inei','ire','gpi','igvie','ievt','iete','enmi','itae','ivti','iee') then x->>'faction' end)), '[]'::jsonb)
    into t from (select x from jsonb_array_elements(case when jsonb_typeof(p_teams) = 'array' then p_teams else '[]'::jsonb end) x
                 where coalesce(btrim(x->>'name'), '') <> '' and coalesce(x->>'id', '') <> '' limit 30) q;
  if jsonb_array_length(t) < 2 then raise exception 'Нужно хотя бы две команды'; end if;
  select round into old from vote_poll where id = 1;
  update vote_poll set round = round + 1, title = left(coalesce(nullif(btrim(p_title), ''), 'Работа со спонсорами'), 60), teams = t,
    status = 'idle', current = null, reveal = false, updated_at = now() where id = 1 returning round into nw;
  insert into vote_members (round, roster_id, team)
    select nw, m.roster_id, m.team from vote_members m where m.round = old and m.team in (select j->>'id' from jsonb_array_elements(t) j);
  delete from vote_ballots where round < nw - 3;
  delete from vote_members where round < nw - 3;
  return vote_state();
end $$;

/** Поиск участника по ФИО: порядок слов любой, одна опечатка в длинных словах; группа — только чтобы различить тёзок. */
create or replace function public._vote_find(p_fio text, p_group text) returns setof public.roster
language plpgsql stable security definer set search_path = public, extensions as $$
declare t text[] := string_to_array(norm_fio(p_fio), ' '); r roster; rt text[]; ok boolean; g text := norm_group(p_group); i int; j int;
begin
  if coalesce(array_length(t, 1), 0) < 2 then return; end if;
  for r in select * from roster where role = 'participant' loop
    rt := string_to_array(r.fio_norm, ' ');
    ok := false;
    for i in 1 .. array_length(t, 1) loop
      for j in 1 .. array_length(t, 1) loop
        if i <> j and levenshtein(t[i], rt[1]) <= roster_tol(rt[1]) and levenshtein(t[j], rt[2]) <= roster_tol(rt[2]) then ok := true; end if;
      end loop;
    end loop;
    if not ok then continue; end if;
    if g <> '' and regexp_replace(g, '\D', '', 'g') <> regexp_replace(r.grp_norm, '\D', '', 'g') then continue; end if;
    return next r;
  end loop;
end $$;
revoke all on function public._vote_find(text, text) from public, anon, authenticated;

/** Вписать человека (себя или товарища) в команду. Пока голосование не открыто, команду можно сменить;
 *  когда открыто — вписаться можно, если ещё нет команды. Свои голоса за новую команду снимаются. */
create or replace function public.vote_join(p_fio text, p_team text, p_group text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vote_poll; uid uuid := auth.uid(); me players; r roster; n int; cur text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if not found or me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  select * into v from vote_poll where id = 1;
  if not exists (select 1 from jsonb_array_elements(v.teams) j where j->>'id' = p_team) then raise exception 'Выбери команду'; end if;
  select count(*) into n from _vote_find(p_fio, p_group);
  if n = 0 then raise exception 'Нет такого ФИО в списке выезда — проверь написание (фамилия и имя)'; end if;
  if n > 1 then raise exception 'Нашлось несколько человек с таким ФИО — допиши группу'; end if;
  select * into r from _vote_find(p_fio, p_group) limit 1;
  select team into cur from vote_members where round = v.round and roster_id = r.id;
  if cur is not null and cur <> p_team and v.status = 'open' then raise exception 'Команду уже не поменять — голосование идёт. Попроси организатора'; end if;
  insert into vote_members (round, roster_id, team) values (v.round, r.id, p_team)
    on conflict (round, roster_id) do update set team = excluded.team;
  delete from vote_ballots b using players p where b.round = v.round and b.team = p_team and b.player_id = p.id and p.roster_id = r.id;
  return vote_state() || jsonb_build_object('joined', _roster_short(r.fio), 'joinedTeam', p_team);
end $$;

/** Организатор: убрать человека из команды. */
create or replace function public.staff_vote_kick(p_roster bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  delete from vote_members where round = (select round from vote_poll where id = 1) and roster_id = p_roster;
  return vote_state();
end $$;

/** Организатор: составы команд с именами (для панели). */
create or replace function public.staff_vote_members() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v vote_poll;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into v from vote_poll where id = 1;
  return coalesce((select jsonb_agg(jsonb_build_object('team', x.j->>'id', 'name', x.j->>'name',
      'people', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', _roster_short(r.fio) || coalesce(' · ' || _fshort(r.faction), '')) order by r.fio), '[]'::jsonb)
                 from vote_members m join roster r on r.id = m.roster_id where m.round = v.round and m.team = x.j->>'id')) order by x.n)
    from jsonb_array_elements(v.teams) with ordinality x(j, n)), '[]'::jsonb);
end $$;

revoke execute on function public.vote_join(text, text, text), public.staff_vote_kick(bigint), public.staff_vote_members() from public, anon;
grant execute on function public.vote_join(text, text, text), public.staff_vote_kick(bigint), public.staff_vote_members() to authenticated;
revoke all on function public._vote_my_team(uuid) from public, anon, authenticated;

-- Полный сброс чистит и составы команд
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
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

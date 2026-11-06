-- v9: в Supabase запросы из приложения проходят через защиту safeupdate — UPDATE и DELETE без WHERE
-- запрещены («UPDATE requires a WHERE clause»). Миграции идут напрямую в базу и этой защиты не видят,
-- поэтому в проверках всё работало, а из приложения падали: кнопка «Сбросить всё», пересчёт влияния
-- фракций в стычке (если раунд закрывал игрок, а не pg_cron) и «Новая игра» у ведущего кнопки.
-- Логика функций не меняется: там, где намеренно трогается вся таблица, добавлено явное «where true».
-- Локальные тесты (supabase/tests/run.sh) теперь гоняют сценарии с той же защитой.

-- ---------- Сброс (v6) ----------
/** Обнуление прогресса всех игроков. Возвращает короткий отчёт без имён. */
create or replace function public._reset_progress() returns jsonb language plpgsql security definer set search_path = public as $$
declare n_players int; n_subs int; n_orders int; n_claims int; v_epoch int;
begin
  select count(*) into n_players from players where roster_id is not null;
  select count(*) into n_subs from submissions;
  select count(*) into n_orders from merch_orders where status <> 'cancelled';
  select count(*) into n_claims from lecture_claims;

  -- мерч: вернуть на склад всё, что забронировали или выдали
  update merch_items it set stock = it.stock + o.n
    from (select item_id, count(*)::int n from merch_orders where status <> 'cancelled' group by item_id) o
    where o.item_id = it.id;
  update merch_items set last_sale_at = now() where true;  -- автоскидка считается с момента сброса
  delete from merch_orders where true;

  -- задания, баллы, отметки, уведомления
  delete from rating_log where true;
  delete from submissions where true;
  delete from notifications where true;
  delete from lecture_claims where true;
  delete from lectures where true;
  delete from quiz_sessions where true;
  delete from answers where true;
  delete from egg_redeems where true;
  delete from cache_finds where true;
  delete from meets where true;
  delete from referrals where true;
  delete from staff_duty where true;
  delete from announcements where true;
  delete from login_attempts where true;

  -- карта и мероприятия
  delete from orders where true;
  delete from cooldowns where true;
  delete from rounds where true;
  delete from event_scores where true;
  delete from events where true;
  update map_points set owner = null, shield_round = 0 where true;
  update faction_world set influence = 0, trophies = '{}' where true;
  update world set round = 1, next_at = next_round_time(now()) where id = 1;
  update pb_buildings set xp = 0 where true;

  -- игроки: состояние игры собирается заново при следующем входе
  update players set rating = 0, power = 0, stage = 1, state = '{}'::jsonb, contributed = 0,
    contrib_at = null, contrib_day = null, contrib_day_xp = 0, power_at = null, updated_at = now() where true;

  v_epoch := setting_int('progress_epoch', 0) + 1;
  insert into settings (key, value) values ('progress_epoch', to_jsonb(v_epoch))
    on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('players', n_players, 'submissions', n_subs, 'orders', n_orders, 'qr', n_claims, 'epoch', v_epoch);
end $$;
revoke all on function public._reset_progress() from public, anon, authenticated;

-- ---------- Сброс регистраций (v7) ----------
/** Сброс регистраций: никто не привязан, все открытые сессии при следующем запросе попадут на экран входа. */
create or replace function public._reset_registrations() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from roster where tg_id is not null or device_hash is not null or player_id is not null;
  update roster set tg_id = null, device_hash = null, bound_at = null, player_id = null where true;
  -- me() и save_progress требуют roster_id: без него игра показывает вход, а roster_attach вернёт связь
  update players set roster_id = null, tg_id = null where true;
  delete from login_attempts where true;
  return n;
end $$;
revoke all on function public._reset_registrations() from public, anon, authenticated;

-- ---------- Итоги раунда на карте ----------
create or replace function public.resolve_round() returns void
language plpgsql security definer set search_path = public as $$
declare
  r int; p map_points; att_f text; att_s numeric; def_s numeric; prob numeric; win boolean;
  owners_n int; results jsonb := '[]'::jsonb; o record; v_won boolean; got jsonb;
begin
  select round into r from world where id = 1 for update;
  for p in select * from map_points order by id loop
    if p.shield_round >= r then continue; end if;
    select pl.faction, sum(strike_power(pl.faction, 'attack', o2.power, pl.stage, o2.law)) into att_f, att_s
      from orders o2 join players pl on pl.id = o2.player_id
      where o2.round = r and o2.kind = 'attack' and o2.point = p.id and pl.faction is distinct from p.owner
        and not exists (select 1 from cooldowns c where c.player_id = o2.player_id and c.round = r)
      group by pl.faction order by 2 desc limit 1;
    if att_f is null then continue; end if;
    select coalesce(sum(strike_power(pl.faction, 'defend', o2.power, pl.stage, o2.law)), 0) into def_s
      from orders o2 join players pl on pl.id = o2.player_id
      where o2.round = r and o2.kind = 'defend' and o2.point = p.id and pl.faction = p.owner
        and not exists (select 1 from cooldowns c where c.player_id = o2.player_id and c.round = r);
    def_s := def_s + case when p.owner is null then 380 * (1 + r * 0.08) else 250 end;
    if p.owner is not null then
      select count(*) into owners_n from players where faction = p.owner and not is_staff;
      if owners_n < 5 then def_s := def_s * 1.3; end if; -- защита малочисленных ПБ
    end if;
    prob := att_s / (att_s + def_s);
    win := random() < prob;
    results := results || jsonb_build_object('point', p.id, 'attacker', att_f, 'defender', p.owner, 'sAtt', round(att_s), 'sDef', round(def_s),
      'p', round(prob, 3), 'winner', case when win then att_f else p.owner end, 'changed', win);
    if win then update map_points set owner = att_f, shield_round = r + 1 where id = p.id; end if;
  end loop;
  update faction_world fw set influence = fw.influence + coalesce((select sum(mp.influence) from map_points mp where mp.owner = fw.faction), 0) where true;
  -- итоги приказов
  for o in select o2.*, pl.faction, pl.stage from orders o2 join players pl on pl.id = o2.player_id where o2.round = r and o2.kind is not null loop
    if exists (select 1 from cooldowns c where c.player_id = o.player_id and c.round = r) then continue; end if;
    v_won := case when o.kind = 'attack' then exists (select 1 from jsonb_array_elements(results) x where x->>'point' = o.point and (x->>'changed')::boolean and x->>'winner' = o.faction)
                else (select owner from map_points where id = o.point) = o.faction end;
    got := case when v_won then _grant_game(o.player_id, 'skirmish', coalesce((select sum(amount) from rating_log where player_id = o.player_id and day = msk_day() and source = 'skirmish'), 0)::int + 10) else null end;
    update orders set won = v_won, rating = coalesce((got->>'granted')::int, 0), s = round(strike_power(o.faction, o.kind, o.power, o.stage, o.law))
      where player_id = o.player_id and round = r;
  end loop;
  insert into rounds (round, results) values (r, results) on conflict (round) do update set results = excluded.results, at = now();
  update world set round = r + 1, next_at = next_round_time(greatest(now(), next_at)) where id = 1;
end $$;


-- ---------- Кнопка «Ты — лидер»: действия ведущего ----------
create or replace function public.bz_host(p_host text, p_act text, p_arg jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t double precision := bz_ms(); g bz_game; rid int; n int; tid int; v text; names text[]; i int; nm text;
  cd int; code text; a jsonb := coalesce(p_arg, '{}'::jsonb);
begin
  if not _bz_host_ok(p_host) then return jsonb_build_object('error', 'auth'); end if;
  select * into g from bz_game where id = 1 for update;

  if p_act = 'start' then
    update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'next'
      where id = g.round_id and status = 'open';
    select coalesce(max(x.n), 0) + 1 into n from bz_rounds x where x.status <> 'void';
    cd := greatest(0, least(10000, coalesce((a->>'countdown_ms')::int, g.countdown_ms)));
    insert into bz_rounds (n, created_ms, opens_ms, closes_ms)
    values (n, t, t + cd, case when g.limit_ms > 0 then t + cd + g.limit_ms end) returning id into rid;
    update bz_game set round_id = rid where id = 1;

  elsif p_act = 'stop' then
    update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'host'
      where id = g.round_id and status = 'open';

  elsif p_act = 'void' then
    -- переиграть вопрос: нажатия и баллы этого вопроса не считаются, номер вопроса не тратится
    update bz_rounds set status = 'void', closed_ms = coalesce(closed_ms, t), closed_by = coalesce(closed_by, 'void')
      where id = g.round_id;

  elsif p_act = 'verdict' then
    rid := coalesce((a->>'round')::int, g.round_id); tid := (a->>'team')::int; v := a->>'v';
    if v is not null and v not in ('ok', 'bad') then return jsonb_build_object('error', 'bad verdict'); end if;
    update bz_presses set verdict = v,
      points = case v when 'ok' then g.pts_ok when 'bad' then -g.pts_bad else 0 end
      where round_id = rid and team_id = tid;
    if not found then return jsonb_build_object('error', 'Эта команда не нажимала'); end if;
    -- верный ответ — вопрос закрыт
    if v = 'ok' then
      update bz_rounds set status = 'closed', closed_ms = least(t, coalesce(closes_ms, t)), closed_by = 'ok'
        where id = rid and status = 'open';
    end if;

  elsif p_act = 'adjust' then
    tid := (a->>'team')::int;
    if not exists(select 1 from bz_teams where id = tid) then return jsonb_build_object('error', 'Нет команды'); end if;
    insert into bz_adjust (team_id, delta) values (tid, greatest(-100, least(100, coalesce((a->>'delta')::int, 0))));

  elsif p_act = 'teams' then
    select array_agg(left(btrim(x), 40) order by o) into names
    from jsonb_array_elements_text(coalesce(a->'names', '[]'::jsonb)) with ordinality e(x, o) where btrim(x) <> '';
    if coalesce(array_length(names, 1), 0) < 1 or array_length(names, 1) > 20 then
      return jsonb_build_object('error', 'Нужно от 1 до 20 команд');
    end if;
    for i in 1 .. array_length(names, 1) loop
      nm := names[i];
      update bz_teams set name = nm, active = true where num = i;
      if not found then insert into bz_teams (num, name) values (i, nm); end if;
    end loop;
    update bz_teams set active = false, captain = null, claimed_at = null where num > array_length(names, 1);

  elsif p_act = 'release' then
    update bz_teams set captain = null, claimed_at = null where id = (a->>'team')::int;
  elsif p_act = 'release_all' then
    update bz_teams set captain = null, claimed_at = null where captain is not null;
  elsif p_act = 'lock' then
    update bz_game set teams_locked = coalesce((a->>'on')::boolean, not teams_locked) where id = 1;

  elsif p_act = 'settings' then
    -- greatest/least пропускают null, поэтому каждое поле меняем, только если оно пришло
    update bz_game set
      title = case when a ? 'title' and btrim(a->>'title') <> '' then left(btrim(a->>'title'), 60) else title end,
      countdown_ms = case when a ? 'countdown_ms' then greatest(0, least(10000, (a->>'countdown_ms')::int)) else countdown_ms end,
      limit_ms = case when a ? 'limit_ms' then greatest(0, least(600000, (a->>'limit_ms')::int)) else limit_ms end,
      lockout_ms = case when a ? 'lockout_ms' then greatest(0, least(5000, (a->>'lockout_ms')::int)) else lockout_ms end,
      pts_ok = case when a ? 'pts_ok' then greatest(0, least(100, (a->>'pts_ok')::int)) else pts_ok end,
      pts_bad = case when a ? 'pts_bad' then greatest(0, least(100, (a->>'pts_bad')::int)) else pts_bad end,
      auto_close = case when a ? 'auto_close' then (a->>'auto_close')::boolean else auto_close end
    where id = 1;

  elsif p_act = 'new_game' then
    -- новая игра: вопросы, нажатия и счёт с нуля; команды и капитаны остаются
    update bz_game set round_id = null where id = 1;
    delete from bz_presses where true; delete from bz_rounds where true; delete from bz_adjust where true;

  elsif p_act = 'host_code' then
    code := _bz_norm_code(a->>'code');
    if code = '' then update bz_game set host_code_hash = null where id = 1;
    elsif length(code) < 4 then return jsonb_build_object('error', 'Код — минимум 4 символа');
    else update bz_game set host_code_hash = _bz_hash(code) where id = 1;
    end if;

  elsif p_act = 'logout_others' then
    delete from bz_hosts where token_hash <> _bz_hash(p_host);

  else
    return jsonb_build_object('error', 'Неизвестное действие');
  end if;

  perform _bz_bump();
  return _bz_view(true, null) || jsonb_build_object('t', bz_ms());
end $$;


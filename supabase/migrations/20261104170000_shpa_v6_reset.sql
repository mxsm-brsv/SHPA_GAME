-- v6: старт с чистого листа. Прогресс всех обнуляется (решение организаторов 4 ноября), список выезда,
-- привязки входа, роли, вопросы, задания, мерч и настройки остаются. Эпоха прогресса не даёт открытым
-- старым вкладкам записать прежнее состояние поверх обнулённого.

insert into public.settings (key, value) values ('progress_epoch', '0') on conflict (key) do nothing;

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
  update merch_items set last_sale_at = now();  -- автоскидка считается с момента сброса
  delete from merch_orders;

  -- задания, баллы, отметки, уведомления
  delete from rating_log;
  delete from submissions;
  delete from notifications;
  delete from lecture_claims;
  delete from lectures;
  delete from quiz_sessions;
  delete from answers;
  delete from egg_redeems;
  delete from cache_finds;
  delete from meets;
  delete from referrals;
  delete from staff_duty;
  delete from announcements;
  delete from login_attempts;

  -- карта и мероприятия
  delete from orders;
  delete from cooldowns;
  delete from rounds;
  delete from event_scores;
  delete from events;
  update map_points set owner = null, shield_round = 0;
  update faction_world set influence = 0, trophies = '{}';
  update world set round = 1, next_at = next_round_time(now()) where id = 1;
  update pb_buildings set xp = 0;

  -- игроки: состояние игры собирается заново при следующем входе
  update players set rating = 0, power = 0, stage = 1, state = '{}'::jsonb, contributed = 0,
    contrib_at = null, contrib_day = null, contrib_day_xp = 0, power_at = null, updated_at = now();

  v_epoch := setting_int('progress_epoch', 0) + 1;
  insert into settings (key, value) values ('progress_epoch', to_jsonb(v_epoch))
    on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('players', n_players, 'submissions', n_subs, 'orders', n_orders, 'qr', n_claims, 'epoch', v_epoch);
end $$;
revoke all on function public._reset_progress() from public, anon, authenticated;

/** Кнопка в панели (только админы): ещё раз обнулить всё, например после тестов. */
create or replace function public.admin_reset_progress(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Сбросить прогресс могут только админы'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'СБРОС' then raise exception 'Для подтверждения введи слово СБРОС'; end if;
  return _reset_progress();
end $$;
revoke execute on function public.admin_reset_progress(text) from public, anon;
grant execute on function public.admin_reset_progress(text) to authenticated;

-- ---------- Игрок: эпоха прогресса ----------
create or replace function public.me() returns jsonb language plpgsql security definer set search_path = public as $$
declare p players;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = auth.uid();
  if not found or p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  return jsonb_build_object('id', p.id, 'username', p.username, 'faction', p.faction, 'rating', p.rating, 'state', p.state,
    'role', p.role, 'secret', p.secret, 'contributed', p.contributed, 'epoch', setting_int('progress_epoch', 0));
end $$;

/** Сохранение принимается только от вкладки, открытой после последнего сброса (p_epoch = текущей эпохе). */
drop function if exists public.save_progress(jsonb, int, int);
create or replace function public.save_progress(p_state jsonb, p_power int, p_stage int, p_epoch int default null)
returns void language plpgsql security definer set search_path = public as $$
declare p players; hrs numeric; maxp numeric; maxs int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(p_epoch, -1) <> setting_int('progress_epoch', 0) then raise exception 'progress_reset'; end if;
  if octet_length(p_state::text) > 200000 then raise exception 'state too large'; end if;
  select * into p from players where id = auth.uid() for update;
  if not found or p.roster_id is null then raise exception 'not in roster'; end if;
  hrs := least(2, extract(epoch from now() - coalesce(p.power_at, p.updated_at, now() - interval '1 hour')) / 3600.0);
  maxp := greatest(p.power, 600) + (greatest(p.power, 600) * 0.6 + 4000) * greatest(hrs, 0.02);
  maxs := p.stage + 2 + floor(hrs * 360)::int;
  update players set
    state = p_state,
    power = greatest(0, least(coalesce(p_power, 0), maxp::int)),
    stage = greatest(1, least(coalesce(p_stage, 1), maxs, 51)),
    power_at = now(),
    updated_at = now()
  where id = auth.uid();
end $$;
revoke execute on function public.save_progress(jsonb, int, int, int) from public, anon;
grant execute on function public.save_progress(jsonb, int, int, int) to authenticated;

-- Разовый сброс при выкатке v6
select public._reset_progress();

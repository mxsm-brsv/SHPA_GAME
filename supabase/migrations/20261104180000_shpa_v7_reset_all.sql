-- v7: сброс «вообще всего» (решение организаторов 4 ноября): к обнулению прогресса из v6 добавляется
-- сброс регистраций — привязки входа к Telegram и устройствам. Каждый, включая организаторов,
-- входит заново по ФИО (и группе или коду организатора). Список выезда и роли остаются.

/** Сброс регистраций: никто не привязан, все открытые сессии при следующем запросе попадут на экран входа. */
create or replace function public._reset_registrations() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from roster where tg_id is not null or device_hash is not null or player_id is not null;
  update roster set tg_id = null, device_hash = null, bound_at = null, player_id = null;
  -- me() и save_progress требуют roster_id: без него игра показывает вход, а roster_attach вернёт связь
  update players set roster_id = null, tg_id = null;
  delete from login_attempts;
  return n;
end $$;
revoke all on function public._reset_registrations() from public, anon, authenticated;

/** Всё сразу: прогресс + регистрации. */
create or replace function public._reset_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := _reset_progress();
  n := _reset_registrations();
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

/** Кнопка в панели (только админы) теперь сбрасывает всё, включая регистрации. */
create or replace function public.admin_reset_progress(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Сбросить всё могут только админы'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'СБРОС' then raise exception 'Для подтверждения введи слово СБРОС'; end if;
  return _reset_all();
end $$;
revoke execute on function public.admin_reset_progress(text) from public, anon;
grant execute on function public.admin_reset_progress(text) to authenticated;

/** Сводка для журнала выкатки — только числа, без имён. */
create or replace function public._db_summary() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roster', (select count(*) from roster),
    'registered', (select count(*) from roster where tg_id is not null or device_hash is not null),
    'players_in_game', (select count(*) from players where roster_id is not null),
    'rating_sum', (select coalesce(sum(rating), 0) from players),
    'submissions', (select count(*) from submissions),
    'merch_orders', (select count(*) from merch_orders),
    'epoch', setting_int('progress_epoch', 0))
$$;
revoke all on function public._db_summary() from public, anon, authenticated;

-- Разовый полный сброс при выкатке v7
select public._reset_all();

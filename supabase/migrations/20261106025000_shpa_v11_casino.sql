-- v11 (6 ноября, ночь): колесо профкома — урок «казино всегда выигрывает». Колесо подкручено в приложении,
-- статистика каждого (ставки, выигрыши, «почти») лежит в его сохранении. Здесь — «Разоблачение»:
-- настройка casino_reveal (включают организаторы) и общий итог казино для экрана в зале.
-- Имя файла — между v10 (20261106020000) и миграцией вечерки (20261106030000 в ветке vecherka).

create or replace function public.staff_set_setting(p_key text, p_value boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_key not in ('shop_open', 'require_group', 'casino_reveal') then raise exception 'unknown setting'; end if;
  if p_key = 'require_group' and not is_admin() then raise exception 'Только админы'; end if;
  insert into settings (key, value) values (p_key, to_jsonb(p_value)) on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.get_config() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h bigint := checkin_host(); hn text;
begin
  -- имя отмечающего — только вошедшим, не анонимному ключу
  if h is not null and auth.uid() is not null then select _roster_short(fio) into hn from roster where id = h; end if;
  return jsonb_build_object('shopOpen', setting_bool('shop_open', false) or test_mode(), 'testMode', test_mode(), 'requireGroup', setting_bool('require_group', true),
    'checkinHost', case when hn is not null then jsonb_build_object('id', h, 'name', hn) end,
    'canCheckin', case when auth.uid() is null then false else can_checkin() end,
    'casinoReveal', setting_bool('casino_reveal', false));
end $$;
grant execute on function public.get_config() to anon, authenticated;

/** Общий итог колеса по сохранениям участников. До разоблачения — только организаторам. */
create or replace function public.casino_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not (is_staff() or setting_bool('casino_reveal', false)) then raise exception 'Итог откроют организаторы'; end if;
  return (select jsonb_build_object(
      'players', count(*) filter (where coalesce((state->'casino'->>'spins')::int, 0) > 0),
      'spins', coalesce(sum((state->'casino'->>'spins')::bigint), 0),
      'bet', coalesce(sum((state->'casino'->>'bet')::bigint), 0),
      'won', coalesce(sum((state->'casino'->>'won')::bigint), 0),
      'near', coalesce(sum((state->'casino'->>'near')::bigint), 0))
    from players where role = 'participant' and roster_id is not null and jsonb_typeof(state->'casino') = 'object');
end $$;
revoke execute on function public.casino_stats() from public, anon;
grant execute on function public.casino_stats() to authenticated;

-- Полный сброс выключает и разоблачение: новый заход — новый урок
create or replace function public._reset_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int;
begin
  r := _reset_progress();
  n := _reset_registrations();
  delete from vote_ballots where true;
  update vote_poll set round = round + 1, status = 'idle', current = null, reveal = false, updated_at = now() where id = 1;
  delete from raid_hits where true;
  delete from raid_progress where true;
  update raid_world set holder = null, held_at = null where id = 1;
  delete from settings where key = 'casino_reveal';
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

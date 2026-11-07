-- v28: организаторы переключают удачу колеса для всех:
--   normal  — как сейчас (профкоины по правилам колеса, баллы всегда проигрывают);
--   win     — профкоины всегда выигрывают (×2, иногда ×10), баллы — как обычно;
--   win_all — выигрывают и профкоины, и ставки баллами (×2 на счёт магазина, рейтинг не меняется).
alter table public.casino_point_bets add column if not exists won int not null default 0;

create or replace function public.casino_mode() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from settings where key = 'casino_mode'), 'normal')
$$;

create or replace function public._points_spent(uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders', (select coalesce(sum(price), 0)::int from merch_orders where player_id = uid and status <> 'cancelled')
            + (select coalesce(sum(amount), 0)::int from goal_donations where player_id = uid),
    'casino', (select coalesce(sum(amount - won), 0)::int from casino_point_bets where player_id = uid),
    'goals', (select coalesce(sum(amount), 0)::int from goal_donations where player_id = uid))
$$;

create or replace function public.game_mode() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lite', is_lite(), 'until', case when is_lite() then ms(lite_until()) end, 'casino', casino_mode())
$$;

create or replace function public.staff_set_casino(p_mode text) returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_mode not in ('normal', 'win', 'win_all') then raise exception 'Режим: normal, win или win_all'; end if;
  if p_mode = casino_mode() then return p_mode; end if;
  insert into settings (key, value) values ('casino_mode', to_jsonb(p_mode)) on conflict (key) do update set value = excluded.value;
  if p_mode <> 'normal' then
    insert into announcements (text, kind, until, author) values (case when p_mode = 'win_all'
      then 'Счастливый час в «Колесе профкома»: сейчас выигрывают и профкоины, и ставки баллами! Успевай, пока не закрыли.'
      else 'Счастливый час в «Колесе профкома»: сейчас профкоины всегда выигрывают! Успевай, пока не закрыли.' end, 'win', now() + interval '30 minutes', auth.uid());
  else
    update announcements set until = now() where text like 'Счастливый час в «Колесе профкома»%' and (until is null or until > now());
  end if;
  return p_mode;
end $$;
revoke all on function public.staff_set_casino(text) from public, anon;
grant execute on function public.staff_set_casino(text) to authenticated;

create or replace function public.casino_points_bet(p_amount int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; s jsonb; bal int; w int := 0;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  if p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  if p.role <> 'participant' then raise exception 'Организаторы ставят только профкоины'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  s := _points_spent(uid);
  bal := p.rating - (s->>'orders')::int - (s->>'casino')::int;
  if coalesce(p_amount, 0) < 1 then raise exception 'Ставка — хотя бы 1 балл'; end if;
  if p_amount > bal then raise exception 'На счёте только % баллов', greatest(bal, 0); end if;
  if casino_mode() = 'win_all' then w := p_amount * 2; end if;
  insert into casino_point_bets (player_id, amount, won) values (uid, p_amount, w);
  return my_wallet() || jsonb_build_object('mult', case when w > 0 then 2 else 0 end, 'lost', p_amount - w);
end $$;

-- Итог для разоблачения: «счастливый час» считаем отдельно, чтобы честная статистика подкрутки не смешивалась с ним
create or replace function public.casino_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not (is_staff() or setting_bool('casino_reveal', false)) then raise exception 'Итог откроют организаторы'; end if;
  return (select jsonb_build_object(
      'players', count(*) filter (where coalesce((state->'casino'->>'spins')::int, 0) > 0),
      'spins', coalesce(sum((state->'casino'->>'spins')::bigint), 0),
      'bet', coalesce(sum((state->'casino'->>'bet')::bigint), 0),
      'won', coalesce(sum((state->'casino'->>'won')::bigint), 0),
      'near', coalesce(sum((state->'casino'->>'near')::bigint), 0),
      'lucky', coalesce(sum((state->'casino'->>'lucky')::bigint), 0))
    from players where role = 'participant' and roster_id is not null and jsonb_typeof(state->'casino') = 'object')
    || (select jsonb_build_object('points', coalesce(sum(amount) filter (where won = 0), 0),
          'pointsPlayers', count(distinct player_id) filter (where won = 0), 'pointsSpins', count(*) filter (where won = 0),
          'pointsLucky', count(*) filter (where won > 0)) from casino_point_bets);
end $$;
revoke execute on function public.casino_stats() from public, anon;
grant execute on function public.casino_stats() to authenticated;

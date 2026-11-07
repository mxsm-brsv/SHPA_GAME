-- v26: «Режим блока» — организатор одной кнопкой ставит игры на паузу на N минут (сервер маленький).
-- Пока пауза: карта, вклад в здания и рейды отвечают «на паузе»; задания, QR, подготовка, мерч, эфир работают.
-- Плюс рейтинг (leaderboard2) считается не чаще раза в 30 секунд для всех сразу.

create or replace function public.lite_until() returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(value #>> '{}', '')::timestamptz from settings where key = 'lite_until'
$$;
create or replace function public.is_lite() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lite_until() > now(), false)
$$;
create or replace function public.game_mode() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lite', is_lite(), 'until', case when is_lite() then ms(lite_until()) end)
$$;
revoke all on function public.game_mode() from public, anon;
grant execute on function public.game_mode() to authenticated;

create or replace function public.staff_set_lite(p_minutes int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u timestamptz;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_minutes, 0) <= 0 then
    insert into settings (key, value) values ('lite_until', 'null'::jsonb) on conflict (key) do update set value = 'null'::jsonb;
    insert into announcements (text, kind, until, author) values ('Игры снова открыты — можно играть!', 'win', now() + interval '10 minutes', auth.uid());
  else
    u := now() + make_interval(mins => least(p_minutes, 240));
    insert into settings (key, value) values ('lite_until', to_jsonb(u)) on conflict (key) do update set value = excluded.value;
    insert into announcements (text, kind, until, author) values ('Идёт блок: мини-игры, карта и бой на паузе до '
      || to_char(u at time zone 'Europe/Moscow', 'HH24:MI') || '. Задания, QR, подготовка и мерч работают.', 'info', u, auth.uid());
  end if;
  return game_mode();
end $$;
revoke all on function public.staff_set_lite(int) from public, anon;
grant execute on function public.staff_set_lite(int) to authenticated;

-- ---------- кэш рейтинга: один расчёт на всех раз в 30 с ----------
create table if not exists public.rpc_cache (key text primary key, at timestamptz not null default now(), val jsonb not null);
alter table public.rpc_cache enable row level security;

alter function public.leaderboard2() rename to _leaderboard2_base;
revoke all on function public._leaderboard2_base() from public, anon, authenticated;
create function public.leaderboard2() returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c rpc_cache; me players;
begin
  select * into c from rpc_cache where key = 'lb';
  if not found or c.at < now() - interval '30 seconds' then
    perform pg_advisory_xact_lock(hashtext('rpc_cache_lb'));
    select * into c from rpc_cache where key = 'lb';
    if not found or c.at < now() - interval '30 seconds' then
      insert into rpc_cache (key, at, val) values ('lb', now(), _leaderboard2_base())
      on conflict (key) do update set at = excluded.at, val = excluded.val
      returning * into c;
    end if;
  end if;
  select * into me from players where id = auth.uid();
  return jsonb_build_object(
    'players', coalesce((select jsonb_agg(e || jsonb_build_object('me', me.id is not null and e->>'name' = me.username and e->>'faction' = me.faction) order by o)
      from jsonb_array_elements(c.val->'players') with ordinality t(e, o)), '[]'::jsonb),
    'factions', c.val->'factions');
end $$;
revoke all on function public.leaderboard2() from public, anon;
grant execute on function public.leaderboard2() to authenticated;

-- ---------- пауза для карты, вклада в здания и рейдов ----------
alter function public.get_world() rename to _get_world_base;
revoke all on function public._get_world_base() from public, anon, authenticated;
create function public.get_world() returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if is_lite() and not is_staff() then raise exception 'Карта на паузе, пока идёт блок'; end if;
  return _get_world_base();
end $$;
revoke all on function public.get_world() from public, anon;
grant execute on function public.get_world() to authenticated;

alter function public.contribute(text, int) rename to _contribute_base;
revoke all on function public._contribute_base(text, int) from public, anon, authenticated;
create function public.contribute(p_building text, p_xp int) returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if is_lite() then raise exception 'Стройка на паузе, пока идёт блок'; end if;
  return _contribute_base(p_building, p_xp);
end $$;
revoke all on function public.contribute(text, int) from public, anon;
grant execute on function public.contribute(text, int) to authenticated;

alter function public.raid_hit(int) rename to _raid_hit_base;
revoke all on function public._raid_hit_base(int) from public, anon, authenticated;
create function public.raid_hit(p_dmg int) returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if is_lite() then raise exception 'Рейд на паузе, пока идёт блок'; end if;
  return _raid_hit_base(p_dmg);
end $$;
revoke all on function public.raid_hit(int) from public, anon;
grant execute on function public.raid_hit(int) to authenticated;

-- v4: бот «ШПА» отвечает на /start по-человечески (имя, баллы, место ПБ), стартовый набор мерча в пустом магазине.

-- ---------- Профиль игрока для бота: только для edge-функции bot (service role) ----------
create or replace function public.service_bot_profile(p_tg bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players; v_place int; v_total int; v_fplace int; v_unread int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service only'; end if;
  select * into p from players where tg_id = p_tg and roster_id is not null;
  if not found then return null; end if;
  select count(*) + 1 into v_place from players
    where roster_id is not null and role = 'participant' and faction <> 'profkom' and rating > p.rating;
  select count(*) into v_total from players where roster_id is not null and role = 'participant' and faction <> 'profkom';
  select count(*) into v_unread from notifications where player_id = p.id and read_at is null;
  select ord into v_fplace from jsonb_array_elements(leaderboard2()->'factions') with ordinality as t(x, ord)
    where x->>'faction' = p.faction;
  return jsonb_build_object('name', p.username, 'faction', p.faction, 'role', p.role, 'rating', p.rating,
    'place', v_place, 'total', v_total, 'fplace', v_fplace, 'unread', v_unread);
end $$;

revoke execute on function public.service_bot_profile(bigint) from public, anon, authenticated;
grant execute on function public.service_bot_profile(bigint) to service_role;

-- ---------- Магазин: если организаторы ещё ничего не завели — кладём стартовый набор ----------
-- (одна покупка каждого вида — 1530 баллов; цены и остатки потом меняются в панели «Мерч»)
insert into public.merch_items (id, name, emoji, descr, price, stock, total, per_person, auto_hours, auto_step, auto_max)
select v.id, v.name, v.emoji, v.descr, v.price, v.stock, v.stock, v.per_person, v.auto_hours, v.auto_step, v.auto_max
from (values
  ('removka', 'Ремувка ППО', '🏷️', 'Брелок-ремувка с молнией', 150, 3, 1, 3::real, 10, 40),
  ('stickers', 'Стикерпак ПБ', '✨', 'Тотемы всех 10 профбюро', 60, 20, 2, 3::real, 10, 40),
  ('pin', 'Значок «Актив»', '📍', 'Металлический значок выезда', 100, 15, 1, 3::real, 10, 40),
  ('notebook', 'Блокнот ШПА', '📓', 'Для конспектов и идей', 120, 10, 1, 3::real, 10, 40),
  ('shopper', 'Шоппер ППО', '👜', 'Сумка с логотипом профкома', 300, 5, 1, 3::real, 10, 40),
  ('hoodie', 'Худи ППО', '🧥', 'Главный приз магазина', 800, 2, 1, null::real, null::int, null::int)
) as v(id, name, emoji, descr, price, stock, per_person, auto_hours, auto_step, auto_max)
where not exists (select 1 from public.merch_items);

-- ---------- Новые мини-игры: «Профбашня» (stack) и «Молния» (flappy) ----------
create or replace function public.add_game_rating(p_source text, p_value int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_source not in ('fever','ring','campaign','runner','stamp','wordle','bus','blocks','merge','crossword','categories','skirmish','stack','flappy') then
    raise exception 'unknown source';
  end if;
  return _grant_game(auth.uid(), p_source, p_value);
end $$;

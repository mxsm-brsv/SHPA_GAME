-- v16: запуск полной версии (7 ноября).
--  • бот видел «ты ещё не вошёл»: Telegram-id хранился в списке выезда, а бот и уведомления искали его у игрока — теперь он
--    копируется игроку при входе (и для уже вошедших) — «Мои баллы» и сообщения бота работают;
--  • тест-режим выключен: магазин открывают организаторы, стычки раз в час, штурм раз в 20 минут;
--  • задания: «Я на выезде» вместо «Еду на выезд», убраны «Собрать ПБ», «Утренний лидер», «Лидеры с историей», «Шаги»,
--    добавлены «Живая молния», «Завтрак с новым знакомым», «Интервью с организатором», «Активный перерыв»;
--  • мерч выезда: новый список с ценами, при которых участник, делающий всё, может купить по штуке каждого вида;
--  • колесо: ставка баллами на мерч — всегда проигрыш; проигранное вычитается из счёта магазина (рейтинг не меняется).

-- ---------- Telegram-id игрока ----------
create or replace function public._roster_sync_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.player_id is not null then
    if new.tg_id is not null then
      update players set tg_id = null where tg_id = new.tg_id and id <> new.player_id;
    end if;
    update players set tg_id = new.tg_id where id = new.player_id and tg_id is distinct from new.tg_id;
  end if;
  return new;
end $$;
drop trigger if exists roster_sync_tg on public.roster;
create trigger roster_sync_tg after insert or update of tg_id, player_id on public.roster
  for each row execute function public._roster_sync_tg();
update players p set tg_id = r.tg_id from roster r where r.player_id = p.id and r.tg_id is not null and p.tg_id is distinct from r.tg_id;

-- ---------- Боевой режим ----------
insert into settings (key, value) values ('test_mode', 'false'::jsonb) on conflict (key) do update set value = 'false'::jsonb;

-- ---------- Задания ----------
insert into public.task_defs (id, amount, lim, moderated, min_text, max_text) values
  ('lightning', 40, 'once', true, null, null), ('breakfast', 20, 'daily', true, null, null),
  ('interview', 30, 'once', true, 120, 1500), ('warmup', 30, 'once', true, null, null)
on conflict (id) do update set amount = excluded.amount, lim = excluded.lim, moderated = excluded.moderated, min_text = excluded.min_text, max_text = excluded.max_text;
-- убранные задания больше не начисляются (строки остаются ради старых записей)
update public.task_defs set lim = '0' where id in ('invite', 'morning', 'monument', 'steps');

-- ---------- Мерч выезда ----------
-- старые тестовые товары: без заказов — удалить, с заказами — снять с продажи
delete from public.merch_items m where not exists (select 1 from merch_orders o where o.item_id = m.id) and m.id not like 's7\_%';
update public.merch_items set active = false, stock = 0 where id not like 's7\_%';
insert into public.merch_items (id, name, emoji, descr, price, stock, total, per_person, auto_hours, auto_step, auto_max) 
select v.id, v.name, v.emoji, v.descr, v.price, v.stock, v.stock, 1, null, null, null from (values
  ('s7_removka', 'Ремувка', '🏷️', 'Брелок-ремувка ППО', 40, 20),
  ('s7_folder', 'Папка «Твоя профсоюзная папка»', '📁', 'Папка для документов', 50, 10),
  ('s7_socks_sachok', 'Носки «Встретимся на сачке»', '🧦', 'Пара носков', 70, 10),
  ('s7_socks_mei', 'Носки «МЭИ»', '🧦', 'Пара носков', 70, 5),
  ('s7_cover', 'Обложка на студенческий', '🪪', 'Обложка для студенческого билета', 80, 3),
  ('s7_bottle', 'Бутылка «Первый энергетический»', '🥤', 'Бутылка для воды', 120, 3),
  ('s7_shopper', 'Шоппер «Первый энергетический»', '👜', 'Сумка-шоппер', 120, 3),
  ('s7_tee_xl', 'Футболка «Первый энергетический» · XL', '👕', 'Размер XL', 180, 1),
  ('s7_tee_l', 'Футболка «Первый энергетический» · L', '👕', 'Размер L', 180, 1),
  ('s7_tee_m', 'Футболка «Первый энергетический» · M', '👕', 'Размер M', 180, 1),
  ('s7_tee_mount_s', 'Футболка с горами · S', '👕', 'Размер S', 180, 1),
  ('s7_sweat_xl', 'Свитшот «Первый энергетический» · XL', '🧥', 'Размер XL', 250, 1),
  ('s7_sweat_m', 'Свитшот «Первый энергетический» · M', '🧥', 'Размер M', 250, 1),
  ('s7_sweat_s', 'Свитшот «Первый энергетический» · S', '🧥', 'Размер S', 250, 1),
  ('s7_hoodie_xl', 'Худи «Колонны понравились» · XL', '🧥', 'Размер XL', 300, 1),
  ('s7_hoodie_l', 'Худи «Колонны понравились» · L', '🧥', 'Размер L', 300, 1),
  ('s7_powerbank', 'Повербанк 30 000 мА·ч', '🔋', 'Зарядка для телефона в дорогу', 350, 2),
  ('s7_org_poster', 'Мотивирующий плакат от Маруси', '🖼️', 'От организаторов: Маруся', 40, 1),
  ('s7_org_toy_nikita', 'Мягкая игрушка от Никиты', '🧸', 'От организаторов: Никита Дулинов', 60, 1),
  ('s7_org_mama', '«Мамин гостинец»', '🍯', 'От организаторов: Ренат Извеков', 50, 1),
  ('s7_org_knit', 'Игрушка, связанная Лизиной мамой 🥰', '🧶', 'От организаторов: Лиза Камнская', 60, 1),
  ('s7_org_snack', 'Снэк-бокс от Даши Ухачевой', '🍿', 'От организаторов: Даша Ухачева', 60, 1),
  ('s7_org_ustav', 'Кастомизированный Устав от Юлечки Сорокиной', '📜', 'От организаторов: Юля Сорокина', 50, 1),
  ('s7_org_pickles', 'Банка огурцов «Папин гостинец»', '🥒', 'От организаторов: Даша Батусова', 50, 1),
  ('s7_org_spinner', 'Крутячок от Матвея Нечаева', '🌀', 'От организаторов: Матвей Нечаев', 40, 1),
  ('s7_org_smile', 'Улыбка Макса Борисова', '😊', 'От организаторов: Макс Борисов', 20, 1),
  ('s7_org_hug', 'Объятия Макса Борисова', '🤗', 'От организаторов: Макс Борисов', 30, 1),
  ('s7_org_energy', 'Энергетик Adrenaline Rush (0,25)', '⚡', 'От организаторов: Катя Корякова', 40, 1),
  ('s7_org_notebook_kk', 'Блокнот «Профсоюз всегда поможет»', '📓', 'От организаторов: Катя Корякова', 40, 1),
  ('s7_org_bunny', '«Мальчик зайчик светлячок малыш»', '🐰', 'От организаторов: Ульяна Полякова', 50, 1),
  ('s7_org_shopper_stip', 'Шоппер Стипкома', '👜', 'От организаторов: Катя Шатрова', 60, 1),
  ('s7_org_bottle_stl', 'Бутылка СТЛ', '🥤', 'От организаторов: Катя Шатрова', 60, 1),
  ('s7_org_notebook_lpb', 'Блокнот ЛПБ', '📓', 'От организаторов: Катя Шатрова', 40, 1),
  ('s7_org_antistress', 'Антистресс СКС', '🫧', 'От организаторов: Катя Шатрова', 40, 1)
) as v(id, name, emoji, descr, price, stock)
on conflict (id) do nothing;

-- ---------- Колесо: ставка баллами ----------
create table if not exists public.casino_point_bets (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  amount int not null check (amount > 0),
  at timestamptz not null default now()
);
create index if not exists casino_point_bets_player on public.casino_point_bets (player_id);
alter table public.casino_point_bets enable row level security;

/** Сколько баллов ушло со счёта магазина: заказы мерча + проигрыш в колесе. */
create or replace function public._points_spent(uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders', (select coalesce(sum(price), 0)::int from merch_orders where player_id = uid and status <> 'cancelled'),
    'casino', (select coalesce(sum(amount), 0)::int from casino_point_bets where player_id = uid))
$$;
revoke all on function public._points_spent(uuid) from public, anon, authenticated;

create or replace function public.my_wallet() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p players; s jsonb; spent int;
begin
  select * into p from players where id = auth.uid();
  if not found then return null; end if;
  s := _points_spent(p.id);
  spent := (s->>'orders')::int + (s->>'casino')::int;
  return jsonb_build_object('earned', p.rating, 'spent', spent, 'balance', p.rating - spent, 'casino', (s->>'casino')::int);
end $$;

create or replace function public.merch_buy(p_item text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it merch_items; p players; price int; spent int; mine int; oid text; o merch_orders; s jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (setting_bool('shop_open', false) or test_mode()) then raise exception 'Магазин мерча ещё закрыт'; end if;
  select * into p from players where id = uid;
  if p.roster_id is null then raise exception 'not in roster'; end if;
  if p.role <> 'participant' then raise exception 'Организаторы играют вне зачёта и мерч не покупают'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  select * into it from merch_items where id = p_item and active for update;
  if not found then raise exception 'Товар не найден'; end if;
  if it.stock <= 0 then raise exception 'Закончилось — кто-то успел раньше'; end if;
  select count(*) into mine from merch_orders where player_id = uid and item_id = it.id and status <> 'cancelled';
  if mine >= it.per_person then raise exception 'В одни руки — % шт.', it.per_person; end if;
  price := merch_price(it);
  s := _points_spent(uid);
  spent := (s->>'orders')::int + (s->>'casino')::int;
  if p.rating - spent < price then raise exception 'Не хватает % баллов', price - (p.rating - spent); end if;
  loop
    oid := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from merch_orders where id = oid);
  end loop;
  insert into merch_orders (id, item_id, player_id, price) values (oid, it.id, uid, price) returning * into o;
  update merch_items set stock = stock - 1, last_sale_at = now() where id = it.id;
  return order_json(o);
end $$;

/** Ставка баллами на колесе: всегда проигрыш. Баллы уходят со счёта магазина, рейтинг не меняется. */
create or replace function public.casino_points_bet(p_amount int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; s jsonb; bal int;
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
  insert into casino_point_bets (player_id, amount) values (uid, p_amount);
  return my_wallet() || jsonb_build_object('mult', 0, 'lost', p_amount);
end $$;
revoke all on function public.casino_points_bet(int) from public, anon;
grant execute on function public.casino_points_bet(int) to authenticated;

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
    from players where role = 'participant' and roster_id is not null and jsonb_typeof(state->'casino') = 'object')
    || (select jsonb_build_object('points', coalesce(sum(amount), 0), 'pointsPlayers', count(distinct player_id), 'pointsSpins', count(*)) from casino_point_bets);
end $$;
revoke execute on function public.casino_stats() from public, anon;
grant execute on function public.casino_stats() to authenticated;

-- Полный сброс чистит и ставки баллами
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
  delete from print_claims where true;
  delete from code_word_claims where true;
  delete from casino_point_bets where true;
  return r || jsonb_build_object('registrations', n);
end $$;
revoke all on function public._reset_all() from public, anon, authenticated;

/** Сводка для журнала выкатки — только числа. */
create or replace function public._db_summary() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roster', (select count(*) from roster),
    'staff', (select count(*) from roster where role in ('staff', 'admin')),
    'admins', (select count(*) from roster where role = 'admin'),
    'checkin_host_set', checkin_host() is not null,
    'registered', (select count(*) from roster where tg_id is not null or device_hash is not null),
    'players_tg_linked', (select count(*) from players where tg_id is not null and roster_id is not null),
    'players_in_game', (select count(*) from players where roster_id is not null),
    'rating_sum', (select coalesce(sum(rating), 0) from players),
    'submissions', (select count(*) from submissions),
    'merch_items', (select count(*) from merch_items where active),
    'merch_units', (select coalesce(sum(stock), 0) from merch_items where active),
    'merch_orders', (select count(*) from merch_orders),
    'print_codes', (select count(*) from print_codes),
    'print_claims', (select count(*) from print_claims),
    'old_caches', (select count(*) from cache_codes),
    'code_words', (select count(*) from code_words),
    'old_eggs', (select count(*) from egg_codes),
    'casino_points', (select coalesce(sum(amount), 0) from casino_point_bets),
    'test_mode', test_mode(),
    'shop_open', setting_bool('shop_open', false),
    'epoch', setting_int('progress_epoch', 0))
$$;
revoke all on function public._db_summary() from public, anon, authenticated;

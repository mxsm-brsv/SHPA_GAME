-- v27: магазин как угодно.
--  • лот можно сделать только для выбранных ПБ (или для всех);
--  • цены всех товаров — разом на ±N%;
--  • «Вернуть невыданное»: все заказы, которые не отметили выданными, отменяются — баллы и остатки возвращаются;
--  • «Сборы» как на DonationAlerts: общая цель (например, «Открыть магазин» на 50 000), участники донатят баллы,
--    есть топ спонсоров; достигнута цель «открыть магазин» — магазин открывается сам;
--  • лимит вклада в здания за день — 12 000 → 200 000 (ребята упирались).
alter table public.merch_items add column if not exists factions text[];

create or replace function public._merch_factions(j jsonb) returns text[] language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'array' or jsonb_array_length(j) = 0 then null
    else (select array_agg(distinct x) from jsonb_array_elements_text(j) x where x in ('inei', 'ire', 'gpi', 'igvie', 'ievt', 'iete', 'enmi', 'itae', 'ivti', 'iee')) end
$$;

create or replace function public.merch_json(it public.merch_items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', it.id, 'name', it.name, 'emoji', it.emoji, 'text', it.descr, 'price', it.price, 'stock', it.stock, 'total', it.total,
    'perPerson', it.per_person, 'discount', it.discount, 'active', it.active, 'lastSaleAt', ms(it.last_sale_at),
    'tiers', coalesce(it.tiers, '[]'::jsonb),
    'unlimited', it.unlimited, 'step', it.price_step, 'sold', merch_sold(it.id), 'factions', coalesce(to_jsonb(it.factions), 'null'::jsonb),
    'auto', case when coalesce(it.auto_hours, 0) > 0 then jsonb_build_object('afterHours', it.auto_hours, 'stepPct', it.auto_step, 'maxPct', it.auto_max) end)
$$;

create or replace function public.merch_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(merch_json(i) order by i.price), '[]'::jsonb) from merch_items i
  where i.active and (coalesce(cardinality(i.factions), 0) = 0 or is_staff()
    or exists (select 1 from players p where p.id = auth.uid() and p.faction = any(i.factions)))
$$;

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
  if coalesce(cardinality(it.factions), 0) > 0 and not (p.faction = any(it.factions)) then raise exception 'Этот лот — только для других ПБ'; end if;
  if not it.unlimited and it.stock <= 0 then raise exception 'Закончилось — кто-то успел раньше'; end if;
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
  update merch_items set stock = case when unlimited then stock else stock - 1 end, last_sale_at = now() where id = it.id;
  return order_json(o);
end $$;

create or replace function public.staff_merch_save(p_item jsonb) returns void language plpgsql security definer set search_path = public as $$
declare v_id text := p_item->>'id'; ex merch_items; v_name text := nullif(left(btrim(coalesce(p_item->>'name', '')), 60), '');
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into ex from merch_items where id = v_id;
  if found then
    if v_name is not null and exists (select 1 from merch_items where id <> ex.id and active and lower(name) = lower(v_name)) then
      raise exception 'Товар «%» уже есть — назови иначе', v_name;
    end if;
    update merch_items set
      name = coalesce(v_name, name),
      emoji = case when p_item ? 'emoji' then left(btrim(coalesce(p_item->>'emoji', '')), 8) else emoji end,
      descr = case when p_item ? 'text' then left(btrim(coalesce(p_item->>'text', '')), 200) else descr end,
      price = greatest(1, coalesce((p_item->>'price')::int, price)),
      stock = greatest(0, coalesce((p_item->>'stock')::int, stock)),
      total = greatest(total, coalesce((p_item->>'stock')::int, stock)),
      per_person = greatest(1, coalesce((p_item->>'perPerson')::int, per_person)),
      discount = least(90, greatest(0, coalesce((p_item->>'discount')::int, discount))),
      auto_hours = case when p_item ? 'auto' then (p_item->'auto'->>'afterHours')::real else auto_hours end,
      auto_step = case when p_item ? 'auto' then (p_item->'auto'->>'stepPct')::int else auto_step end,
      auto_max = case when p_item ? 'auto' then (p_item->'auto'->>'maxPct')::int else auto_max end,
      tiers = case when p_item ? 'tiers' then _merch_tiers(p_item->'tiers') else tiers end,
      unlimited = coalesce((p_item->>'unlimited')::boolean, unlimited),
      price_step = greatest(0, least(1000, coalesce((p_item->>'step')::int, price_step))),
      active = coalesce((p_item->>'active')::boolean, active),
      factions = case when p_item ? 'factions' then _merch_factions(p_item->'factions') else factions end
    where id = v_id;
  else
    insert into merch_items (name, emoji, descr, price, stock, total, per_person, discount, auto_hours, auto_step, auto_max, tiers, unlimited, price_step, factions)
    values (coalesce(v_name, 'Приз'), coalesce(p_item->>'emoji', '🎁'), left(coalesce(p_item->>'text', ''), 200),
      greatest(1, coalesce((p_item->>'price')::int, 100)), greatest(0, coalesce((p_item->>'stock')::int, 1)), greatest(0, coalesce((p_item->>'stock')::int, 1)),
      greatest(1, coalesce((p_item->>'perPerson')::int, 1)), least(90, greatest(0, coalesce((p_item->>'discount')::int, 0))),
      (p_item->'auto'->>'afterHours')::real, (p_item->'auto'->>'stepPct')::int, (p_item->'auto'->>'maxPct')::int,
      _merch_tiers(p_item->'tiers'), coalesce((p_item->>'unlimited')::boolean, false), greatest(0, coalesce((p_item->>'step')::int, 0)), _merch_factions(p_item->'factions'));
  end if;
end $$;

/** Все цены разом: +10 — подорожать на 10%, −10 — подешеветь. Стартовые цены безлимитных тоже. */
create or replace function public.staff_merch_price_all(p_pct int) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_pct, 0) = 0 or p_pct < -90 or p_pct > 500 then raise exception 'Процент — от −90 до +500'; end if;
  update merch_items set price = greatest(1, round(price * (100 + p_pct) / 100.0)::int) where active;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.staff_merch_price_all(int) from public, anon;
grant execute on function public.staff_merch_price_all(int) to authenticated;

/** Все невыданные заказы — отменить: баллы вернутся участникам, штуки — в магазин. */
create or replace function public.staff_orders_cancel_pending() returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; pts int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  with c as (update merch_orders set status = 'cancelled' where status = 'reserved' returning item_id, price)
  , back as (update merch_items m set stock = m.stock + x.n from (select item_id, count(*)::int n from c group by item_id) x where m.id = x.item_id returning 1)
  select count(*)::int, coalesce(sum(price), 0)::int into n, pts from c;
  return jsonb_build_object('orders', n, 'points', pts);
end $$;
revoke all on function public.staff_orders_cancel_pending() from public, anon;
grant execute on function public.staff_orders_cancel_pending() to authenticated;

-- ---------- Сборы ----------
create table if not exists public.goals (
  id bigserial primary key,
  title text not null,
  descr text not null default '',
  target int not null check (target > 0),
  factions text[],
  effect text check (effect in ('open_shop')),
  status text not null default 'open' check (status in ('open', 'done', 'hidden')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create table if not exists public.goal_donations (
  id bigserial primary key,
  goal_id bigint not null references public.goals(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  amount int not null check (amount > 0),
  at timestamptz not null default now()
);
create index if not exists goal_donations_goal on public.goal_donations (goal_id, player_id);
create index if not exists goal_donations_player on public.goal_donations (player_id);
alter table public.goals enable row level security;
alter table public.goal_donations enable row level security;

-- донаты — тоже траты со счёта магазина (рейтинг не падает)
create or replace function public._points_spent(uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders', (select coalesce(sum(price), 0)::int from merch_orders where player_id = uid and status <> 'cancelled')
            + (select coalesce(sum(amount), 0)::int from goal_donations where player_id = uid),
    'casino', (select coalesce(sum(amount), 0)::int from casino_point_bets where player_id = uid),
    'goals', (select coalesce(sum(amount), 0)::int from goal_donations where player_id = uid))
$$;
create or replace function public.my_wallet() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p players; s jsonb; spent int;
begin
  select * into p from players where id = auth.uid();
  if not found then return null; end if;
  s := _points_spent(p.id);
  spent := (s->>'orders')::int + (s->>'casino')::int;
  return jsonb_build_object('earned', p.rating, 'spent', spent, 'balance', p.rating - spent, 'casino', (s->>'casino')::int, 'goals', (s->>'goals')::int);
end $$;

create or replace function public.goal_json(g public.goals, uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', g.id, 'title', g.title, 'text', g.descr, 'target', g.target, 'status', g.status, 'effect', g.effect,
    'factions', coalesce(to_jsonb(g.factions), 'null'::jsonb), 'doneAt', ms(g.done_at),
    'raised', (select coalesce(sum(amount), 0)::int from goal_donations where goal_id = g.id),
    'donors', (select count(distinct player_id)::int from goal_donations where goal_id = g.id),
    'mine', (select coalesce(sum(amount), 0)::int from goal_donations where goal_id = g.id and player_id = uid),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'faction', t.faction, 'amount', t.amount) order by t.amount desc, t.last)
      from (select coalesce(r.fio, p.username) as name, p.faction, sum(d.amount)::int amount, max(d.at) last
            from goal_donations d join players p on p.id = d.player_id left join roster r on r.id = p.roster_id
            where d.goal_id = g.id group by 1, 2 order by 3 desc, 4 limit 10) t), '[]'::jsonb))
$$;
create or replace function public.goals_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(goal_json(g, auth.uid()) order by (g.status = 'done'), g.sort, g.id), '[]'::jsonb) from goals g
  where (g.status <> 'hidden' or is_staff())
    and (coalesce(cardinality(g.factions), 0) = 0 or is_staff()
      or exists (select 1 from players p where p.id = auth.uid() and p.faction = any(g.factions)))
$$;
revoke all on function public.goals_list() from public, anon;
grant execute on function public.goals_list() to authenticated;

create or replace function public.goal_donate(p_goal bigint, p_amount int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p players; g goals; s jsonb; bal int; raised int; amt int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from players where id = uid;
  if p.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  if p.role <> 'participant' then raise exception 'Организаторы не донатят — только участники'; end if;
  if coalesce(p_amount, 0) < 1 then raise exception 'Донат — хотя бы 1 балл'; end if;
  select * into g from goals where id = p_goal for update;
  if not found or g.status = 'hidden' then raise exception 'Сбор не найден'; end if;
  if g.status = 'done' then raise exception 'Цель уже собрана — спасибо!'; end if;
  if coalesce(cardinality(g.factions), 0) > 0 and not (p.faction = any(g.factions)) then raise exception 'Этот сбор — для других ПБ'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  s := _points_spent(uid);
  bal := p.rating - (s->>'orders')::int - (s->>'casino')::int;
  select coalesce(sum(amount), 0)::int into raised from goal_donations where goal_id = g.id;
  amt := least(p_amount, g.target - raised);
  if amt > bal then raise exception 'На счёте только % баллов', greatest(bal, 0); end if;
  insert into goal_donations (goal_id, player_id, amount) values (g.id, uid, amt);
  if raised + amt >= g.target then
    update goals set status = 'done', done_at = now() where id = g.id;
    if g.effect = 'open_shop' then
      insert into settings (key, value) values ('shop_open', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
      insert into announcements (text, kind, until) values ('Цель «' || g.title || '» собрана — магазин мерча открыт! Спасибо спонсорам — лучших наградим.', 'win', now() + interval '2 hours');
    else
      insert into announcements (text, kind, until) values ('Цель «' || g.title || '» собрана! Спасибо всем, кто донатил.', 'win', now() + interval '1 hour');
    end if;
  end if;
  select * into g from goals where id = g.id;
  return goal_json(g, uid) || jsonb_build_object('given', amt, 'wallet', my_wallet());
end $$;
revoke all on function public.goal_donate(bigint, int) from public, anon;
grant execute on function public.goal_donate(bigint, int) to authenticated;

create or replace function public.staff_goal_save(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_title text := nullif(left(btrim(coalesce(p->>'title', '')), 80), '');
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if v_id is null then
    insert into goals (title, descr, target, factions, effect, sort)
    values (coalesce(v_title, 'Новый сбор'), left(coalesce(p->>'text', ''), 300), greatest(1, coalesce((p->>'target')::int, 1000)),
      _merch_factions(p->'factions'), case when p->>'effect' = 'open_shop' then 'open_shop' end, coalesce((p->>'sort')::int, 0))
    returning id into v_id;
  else
    update goals set
      title = coalesce(v_title, title),
      descr = case when p ? 'text' then left(coalesce(p->>'text', ''), 300) else descr end,
      target = greatest(1, coalesce((p->>'target')::int, target)),
      factions = case when p ? 'factions' then _merch_factions(p->'factions') else factions end,
      effect = case when p ? 'effect' then case when p->>'effect' = 'open_shop' then 'open_shop' end else effect end,
      status = case when p->>'status' in ('open', 'done', 'hidden') then p->>'status' else status end,
      done_at = case when p->>'status' = 'open' then null when p->>'status' = 'done' and done_at is null then now() else done_at end,
      sort = coalesce((p->>'sort')::int, sort)
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.staff_goal_save(jsonb) from public, anon;
grant execute on function public.staff_goal_save(jsonb) to authenticated;

-- первая цель — открыть магазин (если магазин уже открыт, организаторы могут скрыть сбор)
insert into public.goals (title, descr, target, effect, sort)
select 'Открыть магазин мерча', 'Магазин откроется, когда все вместе соберём 50 000 баллов. Донать баллы со счёта магазина — рейтинг от этого не падает. Лучших спонсоров из топа организаторы наградят отдельно!', 50000, 'open_shop', 0
where not exists (select 1 from public.goals where effect = 'open_shop');

insert into public.settings (key, value) values ('contrib_daily_cap', '200000'::jsonb)
on conflict (key) do update set value = excluded.value;

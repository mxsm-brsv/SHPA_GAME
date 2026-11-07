-- v20: «Улыбка» и «Объятия» Макса Борисова — без ограничения количества, стартуют дёшево
-- и дорожают на шаг с каждой покупкой (отменённые заказы не считаются).
alter table public.merch_items add column if not exists unlimited boolean not null default false;
alter table public.merch_items add column if not exists price_step int not null default 0 check (price_step >= 0);

create or replace function public.merch_sold(p_item text) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from merch_orders where item_id = p_item and status <> 'cancelled'
$$;

update public.merch_items set unlimited = true, price_step = 1, price = 5, stock = 0, total = 0, per_person = 1000,
  auto_hours = null, auto_step = null, auto_max = null, tiers = '[]'::jsonb, discount = 0
where id = 's7_org_smile';
update public.merch_items set unlimited = true, price_step = 1, price = 10, stock = 0, total = 0, per_person = 1000,
  auto_hours = null, auto_step = null, auto_max = null, tiers = '[]'::jsonb, discount = 0
where id = 's7_org_hug';

-- растущая цена: старт + шаг × сколько уже купили
create or replace function public.merch_base_price(it public.merch_items) returns int language sql stable as $$
  select case when coalesce(it.price_step, 0) > 0 then it.price + it.price_step * merch_sold(it.id)
    else coalesce((select (t->>'price')::int from jsonb_array_elements(coalesce(it.tiers, '[]'::jsonb)) t
                   where it.stock <= (t->>'left')::int and (t->>'price')::int > 0
                   order by (t->>'left')::int asc limit 1), it.price) end
$$;

create or replace function public.merch_json(it public.merch_items) returns jsonb language sql stable as $$
  select jsonb_build_object('id', it.id, 'name', it.name, 'emoji', it.emoji, 'text', it.descr, 'price', it.price, 'stock', it.stock, 'total', it.total,
    'perPerson', it.per_person, 'discount', it.discount, 'active', it.active, 'lastSaleAt', ms(it.last_sale_at),
    'tiers', coalesce(it.tiers, '[]'::jsonb),
    'unlimited', it.unlimited, 'step', it.price_step, 'sold', merch_sold(it.id),
    'auto', case when coalesce(it.auto_hours, 0) > 0 then jsonb_build_object('afterHours', it.auto_hours, 'stepPct', it.auto_step, 'maxPct', it.auto_max) end)
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

-- у безлимитных остаток не ведётся: отмена заказа и сброс его не трогают
create or replace function public._merch_unlimited_stock() returns trigger language plpgsql as $$
begin
  if new.unlimited then new.stock := 0; new.total := 0; end if;
  return new;
end $$;
drop trigger if exists merch_unlimited_stock on public.merch_items;
create trigger merch_unlimited_stock before insert or update on public.merch_items
  for each row execute function public._merch_unlimited_stock();

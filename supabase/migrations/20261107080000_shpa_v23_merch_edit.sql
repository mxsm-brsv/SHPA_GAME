-- v23: организатор редактирует товар целиком: название, эмодзи, описание, «без ограничений» и шаг цены;
-- скрытые товары видны в панели и возвращаются в продажу.
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
      active = coalesce((p_item->>'active')::boolean, active)
    where id = v_id;
  else
    insert into merch_items (name, emoji, descr, price, stock, total, per_person, discount, auto_hours, auto_step, auto_max, tiers, unlimited, price_step)
    values (coalesce(v_name, 'Приз'), coalesce(p_item->>'emoji', '🎁'), left(coalesce(p_item->>'text', ''), 200),
      greatest(1, coalesce((p_item->>'price')::int, 100)), greatest(0, coalesce((p_item->>'stock')::int, 1)), greatest(0, coalesce((p_item->>'stock')::int, 1)),
      greatest(1, coalesce((p_item->>'perPerson')::int, 1)), least(90, greatest(0, coalesce((p_item->>'discount')::int, 0))),
      coalesce((p_item->'auto'->>'afterHours')::real, 3), coalesce((p_item->'auto'->>'stepPct')::int, 10), coalesce((p_item->'auto'->>'maxPct')::int, 40),
      _merch_tiers(p_item->'tiers'), coalesce((p_item->>'unlimited')::boolean, false), greatest(0, coalesce((p_item->>'step')::int, 0)));
  end if;
end $$;

/** Все товары для панели — и скрытые тоже. */
create or replace function public.staff_merch_all() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(merch_json(i) order by i.active desc, i.price) from merch_items i), '[]'::jsonb);
end $$;
revoke all on function public.staff_merch_all() from public, anon;
grant execute on function public.staff_merch_all() to authenticated;

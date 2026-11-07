-- v25: начислить баллы сразу всем участникам выбранных профбюро (когда не успеваем отмечать по QR).
-- Те же правила, что у начисления одному: только организатор (и только отмечающий, если он выбран),
-- лимиты заданий соблюдаются, каждый получает уведомление.
create or replace function public.staff_grant_pb(p_factions text[], p_amount int, p_task text default 'bonus', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl record; g int; n int := 0; skipped int := 0; total int := 0; note text := nullif(btrim(coalesce(p_note, '')), '');
  v_task text := coalesce(nullif(p_task, ''), 'bonus');
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not can_checkin() then raise exception '%', _checkin_denied(); end if;
  if coalesce(p_amount, 0) < 1 or p_amount > 500 then raise exception 'Сумма — от 1 до 500 баллов'; end if;
  if v_task = 'penalty' then raise exception 'Снимать баллы всему ПБ нельзя — только по одному'; end if;
  if coalesce(array_length(p_factions, 1), 0) = 0 then raise exception 'Выбери хотя бы одно ПБ'; end if;
  for pl in select id from players where role = 'participant' and roster_id is not null and faction = any(p_factions) order by id loop
    g := _grant_task(pl.id, v_task, p_amount, 'staff', auth.uid(), coalesce(note, 'всему ПБ'));
    if g > 0 then
      n := n + 1; total := total + g;
      perform _notify(pl.id, 'Организатор начислил +' || g || ' ' || _plural(g, 'балл', 'балла', 'баллов') || ' всему ПБ' || coalesce(': ' || note, ''), 'ok');
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('players', n, 'skipped', skipped, 'granted', total);
end $$;
revoke all on function public.staff_grant_pb(text[], int, text, text) from public, anon;
grant execute on function public.staff_grant_pb(text[], int, text, text) to authenticated;

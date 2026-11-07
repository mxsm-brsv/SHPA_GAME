-- v18: админ может убрать из списка выезда того, кто не едет (строка без входа в игру).
create or replace function public.staff_roster_remove(p_id text) returns text language plpgsql security definer set search_path = public as $$
declare r roster;
begin
  if not is_admin() then raise exception 'Убирать из списка могут только админы'; end if;
  select * into r from roster where id = p_id::bigint;
  if not found then raise exception 'Нет такой строки'; end if;
  if r.player_id is not null and exists (select 1 from players where id = r.player_id and rating > 0) then
    raise exception 'У % уже есть баллы — убрать нельзя, можно только «Сброс»', r.fio;
  end if;
  delete from roster where id = r.id;
  return 'Убран из списка: ' || r.fio;
end $$;
revoke all on function public.staff_roster_remove(text) from public, anon;
grant execute on function public.staff_roster_remove(text) to authenticated;

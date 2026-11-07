-- v21: сообщение организатора из «Эфира» уходит ещё и в бот «ШПА» — всем, кто вошёл в игру из Telegram.
alter table public.announcements add column if not exists bot_at timestamptz;
alter table public.announcements add column if not exists bot_sent int;

drop function if exists public.staff_announce(text, text, int);
create function public.staff_announce(p_text text, p_kind text, p_minutes int) returns bigint language plpgsql security definer set search_path = public as $$
declare aid bigint;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  insert into announcements (text, kind, until, author) values (left(btrim(p_text), 500), case when p_kind in ('info', 'alert', 'win') then p_kind else 'info' end,
    case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end, auth.uid())
  returning id into aid;
  return aid;
end $$;
revoke all on function public.staff_announce(text, text, int) from public, anon;
grant execute on function public.staff_announce(text, text, int) to authenticated;

/** Для бота: текст и Telegram-id получателей. Рассылка одного сообщения — только один раз и только в первые 10 минут. */
create or replace function public.service_announce_targets(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  update announcements set bot_at = now() where id = p_id and bot_at is null and created_at > now() - interval '10 minutes' returning * into a;
  if not found then return null; end if;
  return jsonb_build_object('text', a.text, 'kind', a.kind,
    'ids', coalesce((select jsonb_agg(distinct tg_id) from players where tg_id is not null and roster_id is not null), '[]'::jsonb));
end $$;
create or replace function public.service_announce_sent(p_id bigint, p_n int) returns void language sql security definer set search_path = public as $$
  update announcements set bot_sent = p_n where id = p_id
$$;
revoke all on function public.service_announce_targets(bigint), public.service_announce_sent(bigint, int) from public, anon, authenticated;
grant execute on function public.service_announce_targets(bigint), public.service_announce_sent(bigint, int) to service_role;

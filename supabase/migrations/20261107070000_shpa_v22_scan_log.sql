-- v22: журнал сканов для организаторов — кто и когда отметился QR на блоке, нашёл тайник,
-- «Я — скорость», QR из презентации или ввёл кодовое слово, и сколько баллов реально начислено.
-- Баллы берём из rating_log той же транзакции (у скана и начисления одинаковое время now()).
create index if not exists rating_log_player_created on public.rating_log (player_id, created_at);

create or replace function public.staff_scan_log(p_kind text default null, p_limit int default 400) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'at', ms(z.at), 'player', z.player, 'group', z.grp, 'faction', z.faction, 'kind', z.kind, 'title', z.title, 'points', z.points
    ) order by z.at desc) from (
    select e.at, coalesce(r.fio, p.username) as player, r.grp, p.faction, e.kind, e.title,
      coalesce((select sum(l.amount) from rating_log l where l.player_id = e.player_id and l.created_at = e.at), 0)::int as points
    from (
      select c.at, c.player_id, case when l.kind = 'speed' then 'speed' else 'lecture' end as kind, l.title
        from lecture_claims c join lectures l on l.id = c.lecture_id
      union all
      select c.at, c.player_id, pc.kind,
        case pc.kind when 'cache' then 'Тайник №' || pc.n when 'cache_gold' then 'Золотой тайник'
          when 'egg' then 'QR презентации «' || pc.title || '»' else pc.title end
        from print_claims c join print_codes pc on pc.hash = c.hash
      union all
      select c.at, c.player_id, 'word', coalesce('«' || w.word || '»', w.hint, 'Кодовое слово')
        from code_word_claims c join code_words w on w.hash = c.hash
    ) e
    join players p on p.id = e.player_id
    left join roster r on r.id = p.roster_id
    where p_kind is null or p_kind = '' or e.kind = p_kind
      or (p_kind = 'cache' and e.kind = 'cache_gold')
    order by e.at desc
    limit greatest(1, least(coalesce(p_limit, 400), 1500))
  ) z), '[]'::jsonb);
end $$;
revoke all on function public.staff_scan_log(text, int) from public, anon;
grant execute on function public.staff_scan_log(text, int) to authenticated;

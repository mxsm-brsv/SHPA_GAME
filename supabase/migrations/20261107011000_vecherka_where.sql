-- Вечерка: явный «where true» в bz_host для защиты safeupdate в Supabase («Новая игра», «Сбросить голоса»,
-- смена списка клипов). Нужна там, где 20261107010000 применилась раньше этой правки; в чистой базе ничего не меняет.
do $$
declare src text := pg_get_functiondef('public.bz_host(text,text,jsonb)'::regprocedure);
begin
  src := replace(src, 'delete from bz_presses; delete from bz_rounds; delete from bz_adjust;',
                      'delete from bz_presses where true; delete from bz_rounds where true; delete from bz_adjust where true;');
  src := replace(src, E'delete from bz_votes;\n', E'delete from bz_votes where true;\n');
  src := replace(src, E'delete from bz_clips;\n', E'delete from bz_clips where true;\n');
  execute src;
end $$;

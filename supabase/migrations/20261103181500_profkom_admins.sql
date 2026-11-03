-- Весь состав Профкома — админы (решение организаторов 3 ноября): могут загружать список выезда и менять настройки входа.
update public.roster set role = 'admin' where faction = 'profkom' and role = 'staff';
update public.players p set role = 'admin', is_staff = true from public.roster r where r.player_id = p.id and r.faction = 'profkom';

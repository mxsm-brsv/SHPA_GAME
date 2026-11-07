-- v19: в обновлённом списке выезда в одном профбюро 8 человек — лимит входа в ПБ 7 → 8, чтобы зашли все.
insert into public.settings (key, value) values ('pb_limit', '8'::jsonb)
on conflict (key) do update set value = excluded.value;

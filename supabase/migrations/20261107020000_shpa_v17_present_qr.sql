-- v17: QR и кодовые слова для презентаций — по одному на блок.
-- QR из презентации: +15 баллов в счёт пасхалок, один раз на человека, только в день блока.
-- В репозитории — только отпечатки (sha256), сами коды и слова у организаторов.

alter table public.print_codes drop constraint if exists print_codes_kind_check;
alter table public.print_codes add constraint print_codes_kind_check check (kind in ('cache', 'cache_gold', 'speed', 'egg'));

insert into public.print_codes (hash, kind, n, day, points, max_claims, title) values
  ('aab2642fe98edab6a49cfd022dd446de8fabe801b3be66947c3bf6715a7af0fc', 'egg', 1, '2026-11-07', 15, 0, 'Открытие'),
  ('4529ac89eca7fa40e704add8b115b6fb0d2d04eb6d74caea525447a2b57396bc', 'egg', 2, '2026-11-07', 15, 0, 'Знакомка'),
  ('aecdf015eb87d051e1f7cfa949b798b727b1439640fa842ab048320a12901158', 'egg', 3, '2026-11-07', 15, 0, 'Гранты'),
  ('9416ead42a607c4dfbfce3df4753a9a5c1610f20970ac2c27b6b486374680de5', 'egg', 4, '2026-11-07', 15, 0, 'Публичные выступления'),
  ('7c9165e62ec0b2aca77b890299900962d9e9dc387575b69ca297992e868032dc', 'egg', 5, '2026-11-07', 15, 0, 'Управленческие поединки'),
  ('5449cb077e6192816890d767873d70cb5a314e705faf22fba8844e78c70b0ca0', 'egg', 6, '2026-11-07', 15, 0, 'Команда в профбюро'),
  ('1b8dfe34c575e7ee8c2f1c4647b9c229dffd5bd365f6b531228affd80c53cdf5', 'egg', 7, '2026-11-07', 15, 0, 'Личный бренд активиста'),
  ('48780375eb737f3098766f9b697b87af7733318bfe7cf8a529e5a48fd7bf4a6d', 'egg', 8, '2026-11-07', 15, 0, 'Вечерка'),
  ('7030a36da66c68a6ae61afc790966c676aa1f7696f15fea507f1be150e9aee4a', 'egg', 9, '2026-11-08', 15, 0, 'Привлечение спонсоров'),
  ('845c8093bb20836a210dbe605d0e8a643747337a1bde9705f08c66612f0e9be9', 'egg', 10, '2026-11-08', 15, 0, 'Бренд ППО'),
  ('e1aa7650252338e7a5d044058a4ab5fc73b3f8456a1aca8d9d58f85517e0397f', 'egg', 11, '2026-11-08', 15, 0, 'Рефлексия')
on conflict (hash) do nothing;

-- подсказки в панели «Слова»: какой блок вставляет слово в презентацию
update public.code_words set hint = 'Слово №1 · блок «Открытие» (Юля)' where hash = 'b4d3852f3b03439821c4bed96340189ce0d3e8b17e4b67afa931a35cf0ecf55c';
update public.code_words set hint = 'Слово №3 · блок «Знакомка» (Катя К)' where hash = '0c76fdfd77806acc783423bf19ab557b481f5a6ee3864d4c4916721520a75fa3';
update public.code_words set hint = 'Слово №7 · блок «Гранты» (Маруся)' where hash = '7281c2af7be157f27e5aca060ae1573c5265587f08035fe9dd1560b9608495d5';
update public.code_words set hint = 'Слово №2 · блок «Публичные выступления» (Матвей)' where hash = '260e33ba372a42cb80b9324718ba2f0c75f44eab597fb12a43367ed6088a52d7';
update public.code_words set hint = 'Слово №6 · блок «Управленческие поединки» (Лиза)' where hash = '0e8a3d7aeaaa4cd34ec6c1882ccb633efbc375473ed15e168009fc100bcbe127';
update public.code_words set hint = 'Слово №4 · блок «Команда в профбюро» (Никита)' where hash = '76a7d6b69edfaac5d61a8fa0b3a5a69dc29cf4a6222dd80417d711f92e3e42dd';
update public.code_words set hint = 'Слово №5 · блок «Личный бренд активиста» (Маруся / Сергей Т)' where hash = '21f2f1da0ccc5a16b869282fefe07f22743dee7fd7ed192055eac3715a967c24';
update public.code_words set hint = 'Слово №8 · блок «Вечерка» (Матвей)' where hash = 'f3ffa353848d471e8f7a77798435d724bae65e11e2c2d7a1cf2a7049cee0a3aa';
update public.code_words set hint = 'Слово №9 · блок «Привлечение спонсоров» (Ренат)' where hash = '3c2fffa23de46375253350e52a1e23a592ce9b3095069f040d264ca94a01ee3c';
update public.code_words set hint = 'Слово №10 · блок «Бренд ППО» (Ульяна)' where hash = '6b6216011cfa02b1235e0505255ad5f9eee4ae0bcdf3f76b6ad99aacd6ff59ad';
-- слово для «Рефлексии»
insert into public.code_words (hash, hint, points) values
  ('6e5a6716e085fde7fa89113b26e6bd398209834ef2e70d7f5a4a23ddfea5b465', 'Слово №11 · блок «Рефлексия» (Лиза)', 15)
on conflict (hash) do nothing;

create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); me players; v text := _print_norm(p_code); pc print_codes; g int := 0; n int; msg text; w jsonb;
  link boolean := coalesce(p_code, '') ~ 'startapp=t_';
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if length(v) between 8 and 16 then
    select * into pc from print_codes where hash = encode(sha256(convert_to('shpa:' || v, 'UTF8')), 'hex') for update;
  end if;
  if pc.hash is null then
    if link then raise exception 'QR не распознан — такого кода в игре нет'; end if;
    w := _code_word_redeem(uid, p_code);
    if w is not null then return w; end if;
    -- русские буквы, которых нет в кодах QR, — это было кодовое слово
    if coalesce(p_code, '') ~ '[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯбгдёжзийлпфцчшщъыьэюя]' and coalesce(p_code, '') !~ 'startapp='
       and not exists (select 1 from egg_codes where code = upper(btrim(p_code))) then
      raise exception 'Такого кодового слова нет — проверь написание';
    end if;
    -- 10 латинских знаков — похоже на код с распечатки: подсказка понятнее, чем «QR живёт 20 секунд»
    if length(v) = 10 and coalesce(p_code, '') !~ '[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯбгдёжзийлпфцчшщъыьэюя]' then
      raise exception 'Код не подошёл — проверь 10 знаков под QR (буквы O и I в кодах не бывает)';
    end if;
    return _redeem_code_base(p_code);
  end if;
  if uid is null then raise exception 'not authenticated'; end if;
  select * into me from players where id = uid;
  if me.roster_id is null then raise exception 'Войди по ФИО из списка выезда'; end if;
  -- организатор проверяет распечатку: ничего не начисляется и не расходуется
  if me.is_staff then
    select count(*) into n from print_claims where hash = pc.hash;
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Код верный: ' || pc.title
      || case when pc.kind = 'egg' then ' (работает ' || to_char(pc.day, 'DD.MM') || ', отсканировали ' || n || ')'
              when pc.kind = 'speed' then ' (работает ' || to_char(pc.day, 'DD.MM') || ', нашли ' || n || ' из ' || pc.max_claims || ')'
              when pc.kind = 'cache_gold' then case when n > 0 then ' — уже найден' else ' — ещё не найден' end
              else ' — нашли ' || n end
      || '. Организаторам баллы не начисляются');
  end if;
  if exists (select 1 from print_claims where hash = pc.hash and player_id = uid) then
    return jsonb_build_object('granted', 0, 'rating', me.rating, 'message',
      case pc.kind when 'cache' then 'Тайник №' || pc.n || ' уже найден' when 'speed' then 'Этот QR ты уже нашёл'
        when 'egg' then 'QR блока «' || pc.title || '» ты уже отсканировал' else 'Золотой тайник уже твой' end);
  end if;
  if pc.kind = 'cache' then
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'caches', pc.points);
    select count(*) into n from print_claims c join print_codes p on p.hash = c.hash where c.player_id = uid and p.kind = 'cache';
    if n = 10 then g := g + _grant_task(uid, 'bonus', 50, 'task', null, 'все 10 тайников'); end if;
    msg := 'Тайник №' || pc.n || ': +' || g || ' баллов · найдено ' || n || ' из 10' || case when n = 10 then '. Все тайники!' else '' end;
  elsif pc.kind = 'cache_gold' then
    if exists (select 1 from print_claims where hash = pc.hash) then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Золотой тайник уже нашли до тебя');
    end if;
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'cache_gold', pc.points);
    msg := 'ЗОЛОТОЙ ТАЙНИК! +' || g || ' баллов';
  elsif pc.kind = 'egg' then
    if pc.day is not null and today <> pc.day then
      raise exception 'QR блока «%» работает только %', pc.title, to_char(pc.day, 'DD.MM');
    end if;
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'egg', pc.points);
    msg := case when g > 0 then 'Пасхалка из презентации «' || pc.title || '»: +' || g || ' баллов'
                else 'QR верный, но баллы за пасхалки уже на максимуме' end;
  else
    if pc.day is not null and today <> pc.day then
      raise exception 'Этот QR «Я — скорость» работает только %', to_char(pc.day, 'DD.MM');
    end if;
    if (select count(*) from print_claims where hash = pc.hash) >= pc.max_claims then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', 'Опоздал: баллы уже забрали первые ' || pc.max_claims);
    end if;
    if _task_left(uid, 'speed_qr') <= 0 then
      return jsonb_build_object('granted', 0, 'rating', me.rating, 'message', '«Я — скорость» сегодня уже засчитано');
    end if;
    insert into print_claims (hash, player_id) values (pc.hash, uid);
    g := _grant_task(uid, 'speed_qr', pc.points);
    select count(*) into n from print_claims where hash = pc.hash;
    msg := '«Я — скорость»: ты ' || n || '-й! +' || g || ' баллов';
  end if;
  return jsonb_build_object('granted', g, 'rating', (select rating from players where id = uid), 'message', msg);
end $$;
revoke execute on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

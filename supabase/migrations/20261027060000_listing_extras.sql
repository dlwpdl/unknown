-- 부동산 포함된 것: the author's own items next to the four presets (owner 2026-10-27 "포함된것에 +눌러서 더 임의로넣을수잇게").
-- Same guard as 20261027040000 plus one housing key, extras: up to 5 strings of 1–20 characters, each already in
-- the checked body (the app writes them into the body's first line), so safety monitoring still reads every word.
-- Older apps never send extras; existing rows are unaffected.
create or replace function private.guard_listing_details() returns trigger
language plpgsql set search_path = '' as $$
declare
  details jsonb := new.listing_details;
  item record;
  allowed text[];
  deals text[];
  in_body boolean := true;
begin
  if details is null then return new; end if;
  case details->>'type'
    when 'housing' then allowed := array['type','deal','rooms','moveIn','area','includes','extras','lead']; deals := array['rent_offer','rent_wanted','sale','buy'];
    when 'jobs' then allowed := array['type','deal','payUnit','pay','jobTypes','area','hours','duties','apply','lead']; deals := array['hiring','seeking'];
    when 'used' then allowed := array['type','deal','offers','condition','area','lead']; deals := array['sell','buy'];
    else raise exception 'INVALID_LISTING_DETAILS';
  end case;
  if not details ? 'deal' then raise exception 'INVALID_LISTING_DETAILS'; end if;
  for item in select key, value, jsonb_typeof(value) as kind, value #>> '{}' as text from jsonb_each(details) loop
    if not (item.key = any(allowed)) or not (case item.key
      when 'type' then true
      when 'deal' then item.kind = 'string' and item.text = any(deals)
      when 'rooms' then item.kind = 'string' and item.text = any(array['room','studio','1b','1b_den','2b','2b2b','3b','basement'])
      when 'payUnit' then item.kind = 'string' and item.text = any(array['hour','month','year','negotiable'])
      when 'condition' then item.kind = 'string' and item.text = any(array['new','like_new','used','parts'])
      when 'includes' then private.listing_enum_list(item.value, array['furnished','utilities','parking','pets'])
      when 'extras' then item.kind = 'array' and jsonb_array_length(item.value) <= 5
        and not exists (select 1 from jsonb_array_elements(item.value) as element
          where jsonb_typeof(element) <> 'string' or length(btrim(element #>> '{}')) = 0 or length(element #>> '{}') > 20)
      when 'jobTypes' then private.listing_enum_list(item.value, array['full','part','weekend','contract'])
      when 'apply' then private.listing_enum_list(item.value, array['chat','email','phone','visit'])
      when 'area' then item.kind = 'string' and item.text ~ '^[a-z0-9-]{1,40}$'
      when 'moveIn' then item.kind = 'string' and (item.text = 'now' or item.text ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$')
      when 'pay' then case when item.kind = 'number' then (item.value)::numeric >= 0 and (item.value)::numeric < 100000000 else false end
      when 'offers' then item.kind = 'boolean'
      else item.kind = 'string' and length(btrim(item.text)) > 0 and length(item.text) <= (case item.key when 'lead' then 600 when 'hours' then 40 else 200 end)
    end) then raise exception 'INVALID_LISTING_DETAILS'; end if;
    if item.key = 'lead' then in_body := in_body and left(coalesce(new.body, ''), length(item.text)) = item.text;
    elsif item.key in ('hours','duties') then in_body := in_body and strpos(coalesce(new.body, ''), item.text) > 0;
    elsif item.key = 'extras' then in_body := in_body and not exists (
      select 1 from jsonb_array_elements_text(item.value) as extra(text) where strpos(coalesce(new.body, ''), extra.text) = 0);
    end if;
  end loop;
  if not in_body then
    -- A body edit that drops the lead keeps the edit and shows the post as plain text, as before this column.
    if tg_op = 'UPDATE' and old.listing_details is not distinct from details then new.listing_details := null; return new; end if;
    raise exception 'LISTING_DETAILS_NOT_IN_BODY';
  end if;
  return new;
end $$;
revoke all on function private.guard_listing_details() from public;

-- The 직접 추가 confirm button; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values ('listing.fields.extra-add') on conflict do nothing;

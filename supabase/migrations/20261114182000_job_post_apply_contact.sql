-- 구인 글 지원 방법 연락처 (redesign 2026-11-14, I-post-01): the author may add a phone number, an email address and
-- an https apply link to a hiring post. Same guard as 20261113200000 (with 인스위트 세탁기) plus three jobs keys, each a single string the
-- author typed, checked for shape, and already in the checked body (the app writes them into the body's first line),
-- so safety monitoring still reads every word and the contact is visible exactly where the post itself is visible.
-- The lead limit grows from 600 to 900 for that extra line. Older apps never send these keys; existing rows are unaffected.
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
    when 'jobs' then allowed := array['type','deal','payUnit','pay','jobTypes','area','hours','duties','apply','phone','email','link','lead']; deals := array['hiring','seeking'];
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
      when 'includes' then private.listing_enum_list(item.value, array['furnished','utilities','parking','pets','laundry'])
      when 'extras' then item.kind = 'array' and jsonb_array_length(item.value) <= 5
        and not exists (select 1 from jsonb_array_elements(item.value) as element
          where jsonb_typeof(element) <> 'string' or length(btrim(element #>> '{}')) = 0 or length(element #>> '{}') > 20)
      when 'jobTypes' then private.listing_enum_list(item.value, array['full','part','weekend','contract'])
      when 'apply' then private.listing_enum_list(item.value, array['chat','email','phone','visit'])
      when 'area' then item.kind = 'string' and item.text ~ '^[a-z0-9-]{1,40}$'
      when 'moveIn' then item.kind = 'string' and (item.text = 'now' or item.text ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$')
      when 'pay' then case when item.kind = 'number' then (item.value)::numeric >= 0 and (item.value)::numeric < 100000000 else false end
      when 'offers' then item.kind = 'boolean'
      -- Same shapes as validPhone/validEmail/validLink in src/lib/listing-details.ts.
      when 'phone' then item.kind = 'string' and item.text ~ '^\+?[0-9][0-9 ().-]{5,22}[0-9]$'
        and length(regexp_replace(item.text, '\D', '', 'g')) between 7 and 15
      when 'email' then item.kind = 'string' and length(item.text) <= 80
        and item.text ~* '^[^[:space:]@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
      when 'link' then item.kind = 'string' and length(item.text) <= 160
        and item.text ~* '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/[^[:space:]]*)?$'
      else item.kind = 'string' and length(btrim(item.text)) > 0 and length(item.text) <= (case item.key when 'lead' then 900 when 'hours' then 40 else 200 end)
    end) then raise exception 'INVALID_LISTING_DETAILS'; end if;
    if item.key = 'lead' then in_body := in_body and left(coalesce(new.body, ''), length(item.text)) = item.text;
    elsif item.key in ('hours','duties','phone','email','link') then in_body := in_body and strpos(coalesce(new.body, ''), item.text) > 0;
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

-- The composer shows the 연락처 fields only when this answers true. Before this migration the call is missing and the
-- app keeps the fields hidden, so an older guard never rejects a post's details over these keys.
create or replace function public.listing_apply_contact_enabled() returns boolean
language sql stable set search_path = '' as $$ select true $$;
revoke all on function public.listing_apply_contact_enabled() from public, anon;
grant execute on function public.listing_apply_contact_enabled() to authenticated;

-- Post detail bottom bar, apply sheet, body fold and search recent-search controls.
insert into private.behavior_targets(id) values
  ('post.detail.apply'), ('post.detail.ask-author'), ('post.detail.ask'), ('post.detail.body-more'),
  ('post.apply.sms'), ('post.apply.call'), ('post.apply.email'), ('post.apply.chat'),
  ('search.recent.open'), ('search.recent.remove'), ('search.recent.clear')
on conflict do nothing;

notify pgrst, 'reload schema';

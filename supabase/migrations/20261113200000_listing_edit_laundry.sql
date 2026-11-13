-- 부동산 글 수정 (owner 2026-11-13 "글 수정하면 그런걸 넣을데가안보이고"): 글 수정 now rewrites the card with the body in one
-- update, and 포함된 것 gains 인스위트 세탁기 (laundry). Older apps skip include values they do not know and still read the
-- body's first line, which spells the option out.
--
-- 1. Same guard as 20261027060000 with 'laundry' added to the includes allow-list.
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

-- 2. The author may change a listing's price (월세·가격·급여) when editing, through the existing "users update own posts" policy.
--    Stories cannot carry a price (posts_listing_shape); the upper bound matches create_post. Every existing row already
--    passed create_post's check, so the constraint skips the full-table scan.
grant update (price) on public.posts to authenticated;
alter table public.posts add constraint posts_price_max check (price is null or price <= 99999999) not valid;

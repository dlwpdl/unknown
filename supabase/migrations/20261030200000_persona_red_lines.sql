-- Operated characters (personas, seed accounts) never act on real people offline or as reviewers.
-- Owner 2026-10-30 "무조건해야지 금지규칙": no first 1:1 contact with a real member, no joining, following or
-- encoring a real member's meetup, no business or listing reviews or place ratings. Replies to a conversation a
-- real member started stay allowed. Hosting a meetup is refused too: a real member would travel to meet nobody.

create function private.is_operated_character(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u where u.id=p_user
    and (u.raw_app_meta_data ? 'gling_persona' or coalesce(u.email,'') like '%@seed.gling.invalid'));
$$;
revoke all on function private.is_operated_character(uuid) from public, anon, authenticated;

create function private.guard_operated_character() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; other uuid; c public.conversations;
begin
  if tg_table_name='conversations' then
    if new.group_post_id is not null or new.requester_id is null or not private.is_operated_character(new.requester_id) then return new; end if;
    other:=case when new.user_low_id=new.requester_id then new.user_high_id else new.user_low_id end;
    if other is not null and not private.is_operated_character(other) then raise exception 'OPERATED_CHARACTER_FIRST_CONTACT'; end if;
  elsif tg_table_name='messages' then
    if not private.is_operated_character(new.sender_id) then return new; end if;
    select * into c from public.conversations where id=new.conversation_id;
    if c.id is null or c.group_post_id is not null then return new; end if;
    other:=case when c.user_low_id=new.sender_id then c.user_high_id else c.user_low_id end;
    if other is not null and not private.is_operated_character(other)
       and (c.requester_id is null or c.requester_id=new.sender_id)
       and not exists(select 1 from public.messages m where m.conversation_id=c.id and m.sender_id=other) then
      raise exception 'OPERATED_CHARACTER_FIRST_CONTACT';
    end if;
  elsif tg_table_name='meetup_requests' then
    if private.is_operated_character(new.requester_id) and not private.is_operated_character(new.host_id) then raise exception 'OPERATED_CHARACTER_REAL_MEETUP'; end if;
  elsif tg_table_name in ('meetup_rsvps','meetup_waitlist') then
    if private.is_operated_character(new.user_id)
       and not private.is_operated_character((select p.author_id from public.posts p where p.id=new.post_id)) then raise exception 'OPERATED_CHARACTER_REAL_MEETUP'; end if;
  elsif tg_table_name='host_follows' then
    if private.is_operated_character(new.follower_id) and not private.is_operated_character(new.host_id) then raise exception 'OPERATED_CHARACTER_REAL_MEETUP'; end if;
  elsif tg_table_name='meetup_encores' then
    if private.is_operated_character(new.user_id) and not private.is_operated_character(new.host_id) then raise exception 'OPERATED_CHARACTER_REAL_MEETUP'; end if;
  elsif tg_table_name in ('merchant_reviews','listing_reviews') then
    if private.is_operated_character(new.author_id) then raise exception 'OPERATED_CHARACTER_REVIEW'; end if;
  elsif tg_table_name='posts' then
    actor:=new.author_id;
    if (new.place_review_osm_id is not null or new.place_review_score is not null)
       and (tg_op='INSERT' or new.place_review_osm_id is distinct from old.place_review_osm_id or new.place_review_score is distinct from old.place_review_score)
       and private.is_operated_character(actor) then raise exception 'OPERATED_CHARACTER_REVIEW'; end if;
    if new.room_preview is not null and (tg_op='INSERT' or old.room_preview is null) and private.is_operated_character(actor) then
      raise exception 'OPERATED_CHARACTER_REAL_MEETUP';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_operated_character() from public, anon, authenticated;

create trigger conversations_operated_character before insert on public.conversations for each row execute function private.guard_operated_character();
create trigger messages_operated_character before insert on public.messages for each row execute function private.guard_operated_character();
create trigger meetup_requests_operated_character before insert or update of status on public.meetup_requests for each row execute function private.guard_operated_character();
create trigger meetup_rsvps_operated_character before insert on private.meetup_rsvps for each row execute function private.guard_operated_character();
create trigger meetup_waitlist_operated_character before insert on private.meetup_waitlist for each row execute function private.guard_operated_character();
create trigger host_follows_operated_character before insert on private.host_follows for each row execute function private.guard_operated_character();
create trigger meetup_encores_operated_character before insert on private.meetup_encores for each row execute function private.guard_operated_character();
create trigger merchant_reviews_operated_character before insert on private.merchant_reviews for each row execute function private.guard_operated_character();
create trigger listing_reviews_operated_character before insert on public.listing_reviews for each row execute function private.guard_operated_character();
create trigger posts_operated_character before insert or update of place_review_osm_id, place_review_score, room_preview on public.posts for each row execute function private.guard_operated_character();

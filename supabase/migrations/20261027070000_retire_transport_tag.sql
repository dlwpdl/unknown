-- Owner 2026-10-27 "이동은 없애도될듯" → existing 이동 posts move to 라이프.
-- The tags row stays: installed 1.4.4/1.4.5 apps still list tag 13 and may post with it, so the server files those under 라이프.
update public.posts set tag_id = 1 where tag_id = 13;

create function private.retire_transport_tag() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tag_id = 13 then new.tag_id := 1; end if;
  return new;
end $$;
revoke all on function private.retire_transport_tag() from public;

create trigger posts_retire_transport_tag before insert or update of tag_id on public.posts
for each row execute function private.retire_transport_tag();

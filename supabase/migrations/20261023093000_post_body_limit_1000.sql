-- 글 본문 한도를 4,000자에서 1,000자로 낮춘다.
-- 기존에 1,000자를 넘는 글은 지금 길이 안에서만 고칠 수 있게 두고,
-- 새 글과 길어지는 본문은 거부한다. 기존 1..4000 check는 과거 글 보존용으로 남긴다.
create or replace function private.enforce_post_body_limit() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed integer := 1000;
begin
  if tg_op = 'UPDATE' then
    allowed := greatest(allowed, char_length(btrim(old.body)));
  end if;
  if char_length(btrim(new.body)) > allowed then
    raise exception 'POST_BODY_TOO_LONG';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_post_body_limit() from public, anon, authenticated, service_role;

drop trigger if exists posts_body_limit on public.posts;
create trigger posts_body_limit before insert or update on public.posts
for each row execute function private.enforce_post_body_limit();

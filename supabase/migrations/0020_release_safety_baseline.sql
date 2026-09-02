-- Immediate server-side filtering remains active even if asynchronous AI review is unavailable.

create function private.assert_content_allowed(value text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text := lower(normalize(coalesce(value, ''), NFKC));
  compact text;
begin
  compact := regexp_replace(normalized, '[[:space:][:punct:]]+', '', 'g');
  compact := replace(compact, '시발점', '');

  if compact ~ '(씨+발+|시+발+|개+새+끼+|병+신+|좆+|좃+|지+랄+|미친(년|놈)|엿먹|짱깨|쪽바리|깜둥이)'
    or normalized ~ '\m(fuck(ing|er|ed)?|shit(ty)?|bitch(es)?|nigger|faggot)\M'
    or compact ~ '(죽여버리겠|칼로(찌르|찔러|죽이)|폭탄(만들|터뜨리)|총으로(쏘|죽이))'
  then
    raise exception 'CONTENT_NOT_ALLOWED';
  end if;
end;
$$;

revoke all on function private.assert_content_allowed(text) from public, anon, authenticated;

create function private.filter_user_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'posts' then
    perform private.assert_content_allowed(concat_ws(' ', new.title, new.body));
  else
    perform private.assert_content_allowed(new.body);
  end if;
  return new;
end;
$$;

create trigger posts_content_filter
before insert or update of title, body on public.posts
for each row execute function private.filter_user_content();

create trigger comments_content_filter
before insert or update of body on public.comments
for each row execute function private.filter_user_content();

create trigger messages_content_filter
before insert or update of body on public.messages
for each row execute function private.filter_user_content();

-- Seed authors are examples, not verified community members.
update public.profiles as profile
set verification_level = 1,
    nickname = case
      when profile.nickname::text like '%·예시' then profile.nickname
      else (profile.nickname::text || '·예시')::citext
    end
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.email like '%@seed.gling.invalid';

update public.posts
set room_preview = jsonb_set(room_preview, '{verifiedOnly}', 'false'::jsonb)
where room_preview is not null and coalesce((room_preview ->> 'verifiedOnly')::boolean, false);

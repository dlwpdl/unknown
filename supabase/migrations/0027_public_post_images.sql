-- Guests already read public posts, but the private image bucket allowed only signed-in readers.
create function public.is_public_post_image(image_path text)
returns boolean language sql stable strict security definer set search_path = '' as $$
  -- ponytail: scans published image paths; add a GIN index if this query becomes slow.
  select exists (
    select 1 from public.posts post
    join public.profiles author on author.id = post.author_id and author.account_status = 'active'
    where post.status = 'published'
      and post.image_paths @> array[image_path]
      and split_part(image_path, '/', 1) = post.author_id::text
  );
$$;

revoke all on function public.is_public_post_image(text) from public, authenticated, service_role;
grant execute on function public.is_public_post_image(text) to anon;

create policy "guests read published post images"
on storage.objects for select to anon
using (bucket_id = 'post-images' and public.is_public_post_image(name));

-- Meta fetches short-lived signed URLs; this bucket is never exposed to app accounts.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('sns-media', 'sns-media', false, 67108864, array['video/mp4','image/jpeg','image/png'])
on conflict(id) do nothing;

do $$ begin
  if not exists(select 1 from storage.buckets where id='sns-media' and not public
    and file_size_limit=67108864 and allowed_mime_types=array['video/mp4','image/jpeg','image/png']) then
    raise exception 'SNS_MEDIA_BUCKET_CONFIG_MISMATCH';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='deny app account access to sns media') then
    create policy "deny app account access to sns media" on storage.objects as restrictive
      for all to anon, authenticated
      using (bucket_id <> 'sns-media') with check (bucket_id <> 'sns-media');
  end if;
end $$;

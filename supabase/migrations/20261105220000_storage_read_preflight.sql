-- Hosted Storage looks an object up through its info route (object.get_authenticated_info) before every
-- authenticated download, so a get_authenticated-only gate made every meetup profile photo look missing, even
-- to its owner. Who may read is unchanged; signed URLs and listing stay blocked.
alter policy "meetup profile reads require authenticated download" on storage.objects
using(bucket_id<>'meetup-profiles' or (storage.allow_any_operation(array['storage.object.get_authenticated','object.get_authenticated_info'])
    and private.chilling_photo_access(name,'get'))
  or (storage.allow_any_operation(array['storage.object.delete','storage.object.delete_many'])
    and owner_id=(select auth.uid())::text and private.chilling_photo_access(name,'delete')));

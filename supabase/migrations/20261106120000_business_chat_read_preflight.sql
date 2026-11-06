-- Hosted Storage looks an object up through its info route (object.get_authenticated_info) before every
-- authenticated download, so a get_authenticated-only gate made every business chat photo look missing, even
-- to its sender. Who may read is unchanged; signed URLs and listing stay blocked. The info route's response
-- has no owner field, so this does not reveal which operator uploaded a photo.
alter policy "business chat media cannot expose storage metadata" on storage.objects
using(bucket_id<>'chat-images' or not private.is_business_chat(private.business_chat_path_conversation(name)) or (
    storage.allow_any_operation(array['storage.object.get_authenticated','object.get_authenticated_info']) and private.business_chat_media(name,'get'))
    or (storage.allow_any_operation(array['storage.object.delete','storage.object.delete_many'])
      and owner_id=(select auth.uid())::text and private.business_chat_media(name,'delete')));

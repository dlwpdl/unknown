-- Two restrictive storage SELECT policies (20261018041000, 20261019050000) also apply to anon, which had no EXECUTE on
-- their functions, so signing any image signed-out failed with "permission denied" and public post photos never loaded.
-- Both functions return false when auth.uid() is null, so this opens no chat or meetup-profile object to anon.
grant execute on function private.business_chat_media(text,text),private.chilling_photo_access(text,text) to anon;

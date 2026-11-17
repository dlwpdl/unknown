-- A host transfer upserts the host profile, so the public name has to follow updates too.
drop trigger chilling_host_public_name on private.chilling_host_profiles;
create trigger chilling_host_public_name after insert or update of profile on private.chilling_host_profiles
for each row execute function private.publish_chilling_host_name();

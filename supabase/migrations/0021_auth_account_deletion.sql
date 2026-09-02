-- The Edge Function purges user data first, then deletes auth.users.

alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles
add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

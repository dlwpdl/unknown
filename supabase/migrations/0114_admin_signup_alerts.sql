-- Completed first-time signups use the existing admin inbox and asynchronous push queue.
-- Preserve every existing notification kind, including kinds added by other migrations.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' then
    raise exception 'notification kind constraint missing';
  end if;
  if strpos(definition,'''admin_signup''')=0 then
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check ' ||
      replace(definition,'CHECK (','CHECK (kind = ''admin_signup'' or ');
  end if;
end;
$$;

create unique index notifications_signup_once_idx on public.notifications(user_id,target_id)
  where kind='admin_signup';

create function private.notify_profile_signup()
returns trigger language plpgsql security definer set search_path='' as $$
declare city_name text;
begin
  if not exists (select 1 from auth.users u where u.id=new.id and not coalesce(u.is_anonymous,false)
    and coalesce(u.email,'') not like '%@seed.gling.invalid') then return new; end if;
  select city.name into city_name from public.cities city where city.id=new.city_id;
  perform private.notify_admins('admin_signup','user',new.id,
    '새 회원 가입 · ' || new.nickname::text || ' · ' || city_name,'/admin?section=users');
  return new;
end;
$$;
revoke all on function private.notify_profile_signup() from public,anon,authenticated,service_role;

create trigger profiles_notify_admin_signup after insert on public.profiles
  for each row when (new.account_status='active' and new.terms_accepted_at is not null
    and new.privacy_accepted_at is not null and new.ai_safety_consent_at is not null)
  execute function private.notify_profile_signup();

notify pgrst,'reload schema';

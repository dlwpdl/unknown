-- New apps show Lv2 as "신분증 확인" (20261030180000). 0045 gave random Lv2 badges to synthetic seed profiles and 0154
-- only took back Lv3, so the same known, unclaimed seed accounts now return to Lv1 as well. Same guards as 0154:
-- admin/trust grants, real identities, personal data, claimed emails and all content are left untouched.
update public.profiles p
set verification_level=1
from auth.users u
where u.id=p.id and p.verification_level=2
  and exists(select 1 from generate_series(1,142) seed(n)
    where p.id=('10000000-0000-0000-0000-'||lpad(seed.n::text,12,'0'))::uuid
      and u.email='u'||seed.n::text||'@seed.gling.invalid')
  and coalesce(u.raw_app_meta_data,'{}'::jsonb)='{}'::jsonb
  and u.phone_confirmed_at is null
  and not exists(select 1 from auth.identities i where i.user_id=p.id)
  and not exists(select 1 from private.personal_info i where i.user_id=p.id)
  and not exists(select 1 from public.admin_access_logs l where l.scope='trust_level'
    and (l.subject_user_id=p.id or l.resource_id=p.id));

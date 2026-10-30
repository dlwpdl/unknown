-- New apps show Lv2 as "신분증 확인" (20261030220000). Seed and persona accounts (private.is_operated_character, 20261030200000)
-- never showed an ID, and the 45 in production carry gling_persona metadata that 0154's empty-metadata guard skipped.
-- They return to Lv1 with 0154's other guards: admin trust grants, real identities, personal data and phone stay untouched.
update public.profiles p
set verification_level=1
from auth.users u
where u.id=p.id and p.verification_level=2
  and private.is_operated_character(p.id)
  and u.phone_confirmed_at is null
  and not exists(select 1 from auth.identities i where i.user_id=p.id)
  and not exists(select 1 from private.personal_info i where i.user_id=p.id)
  and not exists(select 1 from public.admin_access_logs l where l.scope='trust_level'
    and (l.subject_user_id=p.id or l.resource_id=p.id));

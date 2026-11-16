-- 가입 직후 "gling은 어디서 알게 됐어요?"에 직접 고른 답 (owner 2026-11-15).
-- 링크·설치로 알아낸 경로와 섞지 않으려고 별도 표에 한 사람 한 번만 둔다. 탈퇴 때 auth.users FK로 같이 지워진다.
create table private.signup_source_answers(
  user_id uuid primary key references auth.users(id) on delete cascade,
  answer text not null check (answer in ('instagram','threads','naver','friend','search','kakao','other')),
  created_at timestamptz not null default now()
);
alter table private.signup_source_answers enable row level security;
revoke all on private.signup_source_answers from public,anon,authenticated;

create function public.record_signup_source(p_answer text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_answer is null or p_answer not in ('instagram','threads','naver','friend','search','kakao','other') then raise exception 'INVALID_SIGNUP_SOURCE'; end if;
  insert into private.signup_source_answers(user_id,answer) values(auth.uid(),p_answer) on conflict(user_id) do nothing;
end;
$$;
revoke all on function public.record_signup_source(text) from public,anon,authenticated;
grant execute on function public.record_signup_source(text) to authenticated;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
  ('components_signup-source-question.scrollview.1'),('components_signup-source-question.submit'),('components_signup-source-question.skip')
on conflict (id) do nothing;

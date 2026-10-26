-- A failed AI draft gives its daily use back. Only the draft-post function (service role) may call this.
create or replace function public.release_ai_draft(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.ai_draft_usage set request_count = request_count - 1
  where user_id = p_user_id and request_count > 0
    and usage_date = (select max(usage_date) from private.ai_draft_usage where user_id = p_user_id);
$$;

revoke all on function public.release_ai_draft(uuid) from public, anon, authenticated;
grant execute on function public.release_ai_draft(uuid) to service_role;

-- The writer's new "메모로 되돌리기" control.
insert into private.behavior_targets(id) values ('components_feed-screen.ai-undo')
on conflict (id) do nothing;

-- The old lifetime count permanently locked members out after 30 contacts.
-- Replace it with the serialized daily 3/5/10 allowance and existing anti-spam cooldown;
-- account, blocking and all-message safety monitoring checks remain in force.
create or replace function public.start_conversation(other_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid:=auth.uid(); low_user_id uuid; high_user_id uuid; conversation_id uuid;
  day_start timestamptz; daily_limit integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if current_user_id=other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(current_user_id,other_user_id) then raise exception 'BLOCKED'; end if;
  low_user_id:=least(current_user_id,other_user_id); high_user_id:=greatest(current_user_id,other_user_id);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':conversation',0));
  perform pg_advisory_xact_lock(hashtextextended(low_user_id::text||':'||high_user_id::text,0));
  select id into conversation_id from public.conversations where user_low_id=low_user_id and user_high_id=high_user_id;
  if conversation_id is not null then return conversation_id; end if;
  select date_trunc('day',now() at time zone c.timezone) at time zone c.timezone into day_start
    from public.profiles p join public.cities c on c.id=p.city_id where p.id=current_user_id;
  daily_limit:=(private.membership_details(current_user_id)->>'conversationLimit')::integer;
  if (select count(*) from private.action_rate_events where user_id=current_user_id and action='conversation' and created_at>=day_start)>=daily_limit then
    raise exception 'DAILY_CONVERSATION_LIMIT_REACHED';
  end if;
  -- Keep the existing anti-spam cooldown; membership determines the local-calendar-day allowance.
  perform private.enforce_rate_limit('conversation',daily_limit,now()-day_start,interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id) values(low_user_id,high_user_id)
    on conflict(user_low_id,user_high_id) do nothing;
  select id into conversation_id from public.conversations where user_low_id=low_user_id and user_high_id=high_user_id;
  return conversation_id;
end;
$$;

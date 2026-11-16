-- Member invite passes are 4 weeks (28 days) from now on. Passes already granted keep their length.
-- Business invite passes stay at 14 days. They share grant_invite_reward, so the length depends on who gets it:
-- a member (p_merchant is null) gets up to 28 days per pass, a business up to 14. The 56-day total cap is unchanged for both.
-- Quest passes are converted from the confirmed amount (private.convert_host_quest, up to 28 days) and are not changed here.
alter table private.invite_rewards drop constraint invite_rewards_days_check;
alter table private.invite_rewards add constraint invite_rewards_days_check
  check ((kind = 'business' and days between 1 and 14) or (kind = 'general' and days between 1 and 28));

do $$
declare definition text; anchor text:='granted := least(14, 56 - used);';
begin
  definition:=pg_get_functiondef('private.grant_invite_reward(uuid,uuid,text,uuid,text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'INVITE_REWARD_DAYS_CHANGED'; end if;
  execute replace(definition,anchor,'granted := least(case when p_merchant is null then 28 else 14 end, 56 - used);');
end $$;

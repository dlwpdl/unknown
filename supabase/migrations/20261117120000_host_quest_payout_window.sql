-- 퀘스트 송금 요청 틈: 60일 뒤 8일이 지나면 이용권으로 바꾸는데, 마지막 단계가 그 무렵에 확정되면 송금 요청(받기)을 누를 틈이 없었다.
-- 이제 마지막으로 확정된 단계가 8일 지나야 바꾼다. 관리자 확정(decide_admin_host_quest_step)도 decided_at=now()를 써서 같다.
set local lock_timeout = '5s';

do $$
declare definition text; anchor text:='    and not exists(select 1 from private.host_quest_payouts where quest_id=q.id) then';
begin
  definition:=pg_get_functiondef('private.settle_host_quest(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'HOST_QUEST_SETTLE_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,E'    and not exists(select 1 from private.host_quest_steps where quest_id=q.id and status=''confirmed'' and decided_at>now()-interval ''8 days'')\n'||anchor);
end $$;
notify pgrst,'reload schema';

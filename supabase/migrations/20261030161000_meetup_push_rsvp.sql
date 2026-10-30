-- Meetup reminder push buttons '갈게요 / 못 가요' (owner 2026-10-30, policy §6-10). Additive only: the claim gains one
-- trailing column, rsvp_post_id, set when a meetup_reminder goes to an approved member who can answer through
-- public.set_meetup_rsvp. The host gets the same reminder without buttons. Edge functions deployed before this
-- migration ignore the column, and a newer edge function without it sends the plain push.
do $rsvp$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='kind text, locale text, badge integer)';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'RSVP_CLAIM_HEADER_CHANGED'; end if;
  definition:=replace(definition,anchor,'kind text, locale text, badge integer, rsvp_post_id uuid)');
  anchor:='unread.read_at is null) end';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'RSVP_CLAIM_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||$field$,
      case when p_phase='send' and n.kind='meetup_reminder' and n.target_type='meetup_notice' then
        (select notice.post_id from private.meetup_notification_notices notice
          where notice.id=n.target_id and notice.user_id=n.user_id and notice.request_id is not null
            and private.meetup_tool_member(notice.post_id,n.user_id)) end$field$);
  drop function public.claim_push_notifications(text,integer);
  execute definition;
  alter function public.claim_push_notifications(text,integer) owner to postgres;
  revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role;
  grant execute on function public.claim_push_notifications(text,integer) to service_role;
end;
$rsvp$;
notify pgrst,'reload schema';

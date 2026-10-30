-- Runs against a database that already has personas, a real member, a real meetup, a business and a chat a real member
-- started with a persona (production shape). Every row is 'ALLOWED' or the expected refusal; everything rolls back.
begin;
create temp table rl(name text, got text);
do $$
declare persona uuid; persona2 uuid; realu uuid; convo uuid; realpost uuid; realhost uuid; merchant uuid; e text;
begin
  select id into persona from auth.users where raw_app_meta_data ? 'gling_persona' order by id limit 1;
  select id into persona2 from auth.users where raw_app_meta_data ? 'gling_persona' order by id desc limit 1;
  select u.id into realu from auth.users u join public.profiles p on p.id=u.id where p.account_status='active' and not private.is_operated_character(u.id)
    and not exists(select 1 from private.admin_ids a where a.user_id=u.id) order by u.created_at limit 1;
  select p.id, p.author_id into realpost, realhost from public.posts p where p.room_preview is not null and p.status='published' and not private.is_operated_character(p.author_id) order by p.created_at desc limit 1;
  select id into merchant from private.merchants limit 1;
  select c.id into convo from public.conversations c where c.group_post_id is null and c.requester_id is not null and not private.is_operated_character(c.requester_id)
    and private.is_operated_character(case when c.user_low_id=c.requester_id then c.user_high_id else c.user_low_id end) limit 1;
  insert into rl values ('ids', concat_ws(' ', persona is not null, realu is not null, realpost is not null, merchant is not null, convo is not null));
  begin insert into public.conversations(user_low_id,user_high_id,requester_id,kind,status) values(least(persona,realu),greatest(persona,realu),persona,'direct','pending');
    insert into rl values('persona starts 1:1','ALLOWED'); exception when others then insert into rl values('persona starts 1:1',sqlerrm); end;
  begin insert into public.messages(conversation_id,sender_id,body) select convo, case when c.user_low_id=c.requester_id then c.user_high_id else c.user_low_id end, '테스트 답장' from public.conversations c where c.id=convo;
    insert into rl values('persona replies to real-started chat','ALLOWED'); exception when others then insert into rl values('persona replies to real-started chat',sqlerrm); end;
  begin insert into public.meetup_requests(post_id,host_id,requester_id,status) values(realpost,realhost,persona,'pending');
    insert into rl values('persona applies to real meetup','ALLOWED'); exception when others then insert into rl values('persona applies to real meetup',sqlerrm); end;
  begin insert into private.host_follows(follower_id,host_id) values(persona,realhost);
    insert into rl values('persona follows real host','ALLOWED'); exception when others then insert into rl values('persona follows real host',sqlerrm); end;
  begin insert into private.meetup_encores(post_id,user_id,host_id) values(realpost,persona,realhost);
    insert into rl values('persona encores real meetup','ALLOWED'); exception when others then insert into rl values('persona encores real meetup',sqlerrm); end;
  begin insert into private.meetup_waitlist(post_id,user_id) values(realpost,persona);
    insert into rl values('persona joins real waitlist','ALLOWED'); exception when others then insert into rl values('persona joins real waitlist',sqlerrm); end;
  begin insert into private.merchant_reviews(merchant_id,author_id,score,body,status) values(merchant,persona,5,'좋아요','published');
    insert into rl values('persona merchant review','ALLOWED'); exception when others then insert into rl values('persona merchant review',sqlerrm); end;
  begin insert into public.posts(author_id,city_id,tag_id,title,body,status,room_preview) select persona,'vancouver',(select id from public.tags where kind='post' limit 1),'테스트 모임','테스트','published','{}'::jsonb;
    insert into rl values('persona hosts meetup','ALLOWED'); exception when others then insert into rl values('persona hosts meetup',sqlerrm); end;
  begin insert into public.meetup_requests(post_id,host_id,requester_id,status) values(realpost,realhost,realu,'pending');
    insert into rl values('real member applies (control)','ALLOWED'); exception when others then insert into rl values('real member applies (control)',sqlerrm); end;
  begin insert into private.host_follows(follower_id,host_id) values(realu,realhost);
    insert into rl values('real member follows (control)','ALLOWED'); exception when others then insert into rl values('real member follows (control)',sqlerrm); end;
  begin insert into public.conversations(user_low_id,user_high_id,requester_id,kind,status) values(least(persona,persona2),greatest(persona,persona2),persona,'direct','pending');
    insert into rl values('persona to persona (control)','ALLOWED'); exception when others then insert into rl values('persona to persona (control)',sqlerrm); end;
end $$;
select name, left(got,90) got from rl;
rollback;

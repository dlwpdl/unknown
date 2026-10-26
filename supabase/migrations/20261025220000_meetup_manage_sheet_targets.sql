-- The 모임 관리 sheet records rows as chat.manage.<key>; unregistered targets made the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('chat.manage.location'),('chat.manage.requests'),('chat.manage.share'),('chat.manage.my-open'),('chat.manage.my-change')
on conflict do nothing;

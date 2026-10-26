-- Redesigned meetup and post detail controls; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('post.detail.save'),('post.detail.like'),('post.detail.credits'),
 ('meetup.detail.intro-more'),('meetup.detail.report'),('meetup.detail.tools'),('meetup.detail.ask'),('meetup.tools.back')
on conflict do nothing;

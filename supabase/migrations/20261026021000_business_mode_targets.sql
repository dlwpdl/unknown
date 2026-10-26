-- Business mode: switching back from a meetup and the business writer; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('meetup.detail.switch-personal'),
 ('business.writer.close'),('business.writer.scroll'),('business.writer.photos'),('business.writer.publish'),
 ('business.writer.kind.news'),('business.writer.kind.hire'),('business.writer.kind.menu')
on conflict do nothing;

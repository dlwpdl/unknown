-- 오늘 화면 '처음 할 일' 카드와 설정의 다시 보기; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values ('start-guide.city'), ('start-guide.tour'), ('start-guide.meetup'), ('start-guide.hide'), ('start-guide.tour.done'), ('settings.start-guide.reset') on conflict do nothing;

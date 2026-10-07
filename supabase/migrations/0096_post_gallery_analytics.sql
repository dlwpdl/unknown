-- 0096 (0090 was taken by weekly_ranking_notification): 사진 여러 장 갤러리 컨트롤을 행동 분석 허용목록에 추가한다.
insert into private.behavior_targets(id) values
('components_post-photo-gallery.scrollview.1')
on conflict (id) do nothing;

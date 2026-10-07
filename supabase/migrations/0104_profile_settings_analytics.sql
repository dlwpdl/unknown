-- 비공개 계정 정보 펼치기/접기 컨트롤의 기존 행동 분석 허용목록.
insert into private.behavior_targets(id) values
('components_personal-info-card.pressable.6')
on conflict (id) do nothing;

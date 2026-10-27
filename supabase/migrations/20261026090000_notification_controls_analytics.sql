-- 알림 탭(답글·신청 칩, 모두 읽음, 새로고침 실패 안내)과 알림 설정의 앱·푸시 버튼. 0073과 같은 고정 식별자만 허용한다.
insert into private.behavior_targets(id) values
('app_tabs_notifications.pressable.4'),
('app_tabs_notifications.pressable.5'),
('app_tabs_notifications.pressable.6'),
('app_profile_notifications.pressable.5')
on conflict (id) do nothing;

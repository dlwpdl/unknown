-- Owner 2026-10-29 "ㅇㅇ 닫아 밴쿠버 토론토 몬트리올로 가자": 실제 사용자가 거의 없는 캘거리·에드먼튼을 닫는다.
-- 공개된 글·장소는 지우지 않는다. 되돌리려면 set is_open = true.
update public.cities set is_open = false where id in ('calgary', 'edmonton');

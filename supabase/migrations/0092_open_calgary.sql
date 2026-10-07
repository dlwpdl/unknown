-- Owner request, 2026-09-23. 몬트리올은 0075 에서 열렸고, 캘거리를 함께 연다.
-- 되돌리려면 set is_open = false.
update public.cities set is_open = true where id in ('montreal', 'calgary');

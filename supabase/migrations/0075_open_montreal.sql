-- Owner request, 2026-09-21. Rollback: set is_open = false for Montreal.
update public.cities set is_open = true where id = 'montreal';

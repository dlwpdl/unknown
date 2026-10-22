-- Add the shared Business topic without reclassifying existing posts.
update public.tags set sort_order = 11 where slug = 'meetup';

insert into public.tags (id, slug, label, sort_order, kind)
values (17, 'business', '비즈니스', 10, 'post');

select setval(pg_get_serial_sequence('public.tags', 'id'), (select max(id) from public.tags), true);

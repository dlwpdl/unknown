-- Keep the public board's category order aligned with the app: life, festival, food.
update public.tags set sort_order = sort_order + 1 where sort_order >= 2;

insert into public.tags (id, slug, label, sort_order, kind)
values (16, 'festival', '페스티벌', 2, 'post');

select setval(pg_get_serial_sequence('public.tags', 'id'), (select max(id) from public.tags), true);

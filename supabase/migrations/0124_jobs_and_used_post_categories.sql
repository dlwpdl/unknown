-- Keep jobs and resale at the end; existing posts and listing policies remain intact.
insert into public.tags (id, slug, label, sort_order, kind) values
  (18, 'jobs', '구인구직', 12, 'post'),
  (19, 'used', '중고거래', 13, 'post');

select setval(pg_get_serial_sequence('public.tags', 'id'), (select max(id) from public.tags), true);

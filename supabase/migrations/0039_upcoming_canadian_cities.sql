-- Keep the admin analytics catalog aligned with the upcoming cities shown in the app.
insert into public.cities (id, name, province, timezone, is_open) values
  ('ottawa', '오타와', 'ON', 'America/Toronto', false),
  ('edmonton', '에드먼튼', 'AB', 'America/Edmonton', false),
  ('regina', '리자이나', 'SK', 'America/Regina', false),
  ('saint-john', '세인트존', 'NB', 'America/Moncton', false),
  ('halifax', '할리팩스', 'NS', 'America/Halifax', false);

-- Owner rule 2026-11-11: every compared menu, and the full checkout when recorded, must be cheaper on the webshop than in the Uber Eats app.
-- create or replace: if the constraint below fails on an existing row, fixing the row and re-running does not hit "already exists".
create or replace function private.webshop_cheaper(p_comparisons jsonb,p_checkout jsonb) returns boolean
language sql immutable set search_path='' as $$
  select not exists(select 1 from jsonb_array_elements(p_comparisons) item
      where ((item->>'webCents')::numeric<(item->>'uberCents')::numeric) is not true)
    and (p_checkout is null or p_checkout='null'::jsonb
      or ((p_checkout#>>'{webshop,totalCents}')::numeric<(p_checkout#>>'{uber,totalCents}')::numeric) is true);
$$;
alter function private.webshop_cheaper(jsonb,jsonb) owner to postgres;
revoke all on function private.webshop_cheaper(jsonb,jsonb) from public,anon,authenticated,service_role;
-- Validated on purpose (not NOT VALID): an existing row that breaks the rule fails this migration instead of staying public.
-- save_admin_webshop already maps check_violation to INVALID_WEBSHOP, so its own checks stay unchanged.
alter table private.webshops add constraint webshops_cheaper_than_uber check(private.webshop_cheaper(comparisons,checkout_comparison));

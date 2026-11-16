-- Raise the public place bundle limit from 2MB to 4MB; keep scripts/refresh-city-places.py CATALOG_DB_LIMIT in step.
alter table private.city_place_catalog
  drop constraint city_place_catalog_payload_check,
  add constraint city_place_catalog_payload_check check(jsonb_typeof(payload)='object' and jsonb_typeof(payload->'cities') is not distinct from 'object'
    and jsonb_typeof(payload->'collectedAt') is not distinct from 'string' and octet_length(payload::text)<=4000000);

-- Mirror only accepted, deduplicated clicks; existing RPCs remain the source of truth.
create function private.send_merchant_account_ga4() returns trigger
language plpgsql security definer set search_path='' as $$
declare measurement_id text; api_secret text; merchant_name text; city_id text;
begin
  select decrypted_secret into measurement_id from vault.decrypted_secrets where name='gling_merchant_ga4_measurement_id';
  select decrypted_secret into api_secret from vault.decrypted_secrets where name='gling_merchant_ga4_api_secret';
  if measurement_id is null or measurement_id !~ '^G-[A-Z0-9]{4,20}$'
    or api_secret is null or api_secret !~ '^[A-Za-z0-9_-]{8,128}$' then return new; end if;
  select m.name,m.city_id into merchant_name,city_id from private.merchants m where m.id=new.merchant_id;
  perform net.http_post(
    url:='https://www.google-analytics.com/mp/collect?measurement_id='||measurement_id||'&api_secret='||api_secret,
    headers:=jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=2000,
    body:=jsonb_build_object(
      'client_id',encode(extensions.digest(new.session_id,'sha256'),'hex'),
      'timestamp_micros',floor(extract(epoch from new.created_at)*1000000)::bigint,
      'consent',jsonb_build_object('ad_user_data','DENIED','ad_personalization','DENIED'),
      'events',jsonb_build_array(jsonb_build_object('name','merchant_account_click','params',jsonb_build_object(
        'merchant_id',new.merchant_id,'merchant_name',left(merchant_name,100),'post_id',new.post_id,
        'city_id',city_id,'source_platform',new.platform,
        'session_id',greatest(1,abs(hashtext(new.session_id)::bigint)),'engagement_time_msec',1)))));
  return new;
exception when others then
  -- Analytics must never roll back an accepted first-party click.
  return new;
end;
$$;
revoke all on function private.send_merchant_account_ga4() from public,anon,authenticated;
-- shortcut: GA4 delivery has no retry; add retries only if lost mirrors affect reporting.
create trigger merchant_account_ga4 after insert on private.merchant_source_clicks
for each row execute function private.send_merchant_account_ga4();

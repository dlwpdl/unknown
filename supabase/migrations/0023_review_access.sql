-- Public membership is social-only. Review accounts are provisioned by an admin.
create or replace function public.gling_before_user_created(event jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select case when
    event #>> '{user,app_metadata,provider}' in ('kakao', 'apple')
    or event #> '{user,app_metadata,review_access}' = 'true'::jsonb
    or event #>> '{user,app_metadata,role}' = 'admin'
  then '{}'::jsonb
  else '{"error":{"http_code":403,"message":"Please use Kakao or Apple sign-in. Public email signup is not available."}}'::jsonb end;
$$;

create or replace function public.gling_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  metadata jsonb;
  method text := event ->> 'authentication_method';
begin
  select raw_app_meta_data into metadata from auth.users where id = (event ->> 'user_id')::uuid;
  if metadata ->> 'role' = 'admin'
    or (metadata ->> 'provider' = 'email' and metadata -> 'review_access' = 'true'::jsonb
      and method in ('password', 'token_refresh'))
    or (metadata ->> 'provider' in ('kakao', 'apple') and
      (method = 'oauth' or (method = 'token_refresh'
        and event #> '{claims,amr}' @> '[{"method":"oauth"}]'::jsonb)))
  then
    return jsonb_build_object('claims', event -> 'claims');
  end if;
  return '{"error":{"http_code":403,"message":"This sign-in method is not available for this account."}}'::jsonb;
end;
$$;

revoke all on function public.gling_before_user_created(jsonb), public.gling_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.gling_before_user_created(jsonb), public.gling_access_token_hook(jsonb) to supabase_auth_admin;

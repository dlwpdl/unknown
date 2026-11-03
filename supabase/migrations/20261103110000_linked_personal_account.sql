-- Same rules as 0034 (moved to private in 0142), plus a linked personal account that the owner's app switches into.
-- Safe: linked_to is app_metadata only the service role writes, and the .invalid email cannot receive OTP mail, so a token hash only comes from the service-role generateLink in the linked-account function.
create or replace function private.gling_app_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  metadata jsonb;
  method text := event ->> 'authentication_method';
begin
  select raw_app_meta_data into metadata from auth.users where id = (event ->> 'user_id')::uuid;
  if metadata ->> 'role' = 'admin'
    or (metadata ->> 'provider' = 'email' and metadata -> 'review_access' = 'true'::jsonb
      and method in ('password', 'token_refresh'))
    or (metadata ->> 'provider' in ('kakao', 'apple', 'google') and
      (method = 'oauth' or (method = 'token_refresh'
        and event #> '{claims,amr}' @> '[{"method":"oauth"}]'::jsonb)))
    or (metadata ->> 'provider' = 'email' and metadata ? 'linked_to' and
      (method in ('magiclink', 'otp') or (method = 'token_refresh'
        and (event #> '{claims,amr}' @> '[{"method":"magiclink"}]'::jsonb
          or event #> '{claims,amr}' @> '[{"method":"otp"}]'::jsonb))))
  then
    return jsonb_build_object('claims', event -> 'claims');
  end if;
  return '{"error":{"http_code":403,"message":"This sign-in method is not available for this account."}}'::jsonb;
end;
$$;

-- Analytics target for the profile row: an unknown id would make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values('profile.linked-account') on conflict do nothing;

-- The read also writes an access audit; STABLE makes PostgREST's transaction read-only.
alter function public.get_admin_client_errors(integer, boolean) volatile;

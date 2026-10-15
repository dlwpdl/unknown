begin;
select plan(4);

select is((select provolatile::text from pg_proc where oid = 'public.get_admin_client_errors(integer,boolean)'::regprocedure), 'v',
  'audited error reads require a read-write PostgREST transaction');
select ok((select prosecdef from pg_proc where oid = 'public.get_admin_client_errors(integer,boolean)'::regprocedure),
  'private error access still uses the existing protected definer function');
select ok(has_function_privilege('authenticated', 'public.get_admin_client_errors(integer,boolean)', 'EXECUTE'),
  'authenticated callers retain the existing server authorization path');
select ok(not has_function_privilege('anon', 'public.get_admin_client_errors(integer,boolean)', 'EXECUTE'),
  'anonymous callers cannot invoke the admin error reader');

select * from finish();
rollback;

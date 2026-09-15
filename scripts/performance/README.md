# Local PostgreSQL performance checks

These scripts use an explicitly named local Docker container, never a remote database URL. `benchmark-db.py` rolls back each synthetic fixture. `check-worker-lock.py` briefly commits a uniquely named fixture for its second connection, then removes it in `finally`.

Start a separate container; do not reuse the application's existing volumes:

```sh
docker run -d --name gling-perf-local \
  -e POSTGRES_PASSWORD=local-benchmark-only -p 127.0.0.1:55442:5432 \
  public.ecr.aws/supabase/postgres:17.6.1.165 postgres \
  -c shared_preload_libraries=pg_cron,pg_net \
  -c cron.database_name=postgres -c cron.launch_active_jobs=off
```

Wait for `docker exec gling-perf-local pg_isready -U postgres`, then install `local-bootstrap.sql` as `supabase_admin` and application migrations as `postgres`:

```sh
docker exec -i gling-perf-local psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < scripts/performance/local-bootstrap.sql
for migration in supabase/migrations/*.sql; do
  docker exec -i gling-perf-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration" || break
done
python3 scripts/performance/benchmark-db.py gling-perf-local current
python3 scripts/performance/check-worker-lock.py gling-perf-local
```

The bootstrap supplies the missing Auth sessions/identities and Storage metadata contracts for a bare Postgres image. It does **not** replace a full Supabase integration test, GoTrue, Storage HTTP, or actual push delivery. Application SQL, RLS, pg_cron, and all safety/notification triggers are real. The benchmark disables triggers only while constructing synthetic bulk data, reenables them before timing publishes, and validates category references. Query fixtures have 1,000 authors, 10k/100k posts over 30 days, two hashtags per post, a category on 0.1% of posts, a rare title on 0.01%, and a common title on almost all posts. Feed query timings use guest auth; authenticated block correctness is covered by SQL regression tests.

For before/after comparison, stop migration application at `0041`, run with label `before`, apply `0042` (and `0043` for the integrated checkout), then run with label `after` **sequentially**. JSON samples and JSON EXPLAIN output are written to `/tmp/gling-db-<label>*.{json,txt}`. The first call is warm-up and the next three executions form the reported median. Worker timing is one batch and includes cold function planning; it is not a throughput load test.

Keep scheduled jobs disabled during fixture runs. The worker is called explicitly by tests and the benchmark. To verify scheduling separately, enable `cron.launch_active_jobs` only in this isolated database, then inspect `cron.job_run_details` and queue progress; disable it again before other tests. No safety-monitor HTTP job is configured by this bootstrap.

Remove only the temporary container/anonymous volume you created when finished:

```sh
docker rm -fv gling-perf-local
```

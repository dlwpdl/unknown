"""Run against the disposable local Gling DB: python3 scripts/check-relationship-race.py."""
import concurrent.futures
import json
import subprocess
import uuid


def sql(statement, check=True):
    return subprocess.run(
        ["docker", "exec", "-i", "supabase_db_gling", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=check,
    )


users = [str(uuid.uuid4()) for _ in range(2)]
ids = ",".join("'" + user + "'" for user in users)
try:
    for index, user in enumerate(users):
        sql(f"insert into auth.users(id,email) values('{user}','{user}@race.invalid'); "
            f"insert into public.profiles(id,nickname,city_id) values('{user}','경쟁검증{user[:8]}','vancouver');")
    def start_pair(pair):
        sender, recipient = pair
        claims = json.dumps({"sub": sender, "role": "authenticated"})
        return sql(f"begin; set local statement_timeout='10s'; select set_config('request.jwt.claims','{claims}',true); "
                   f"set local role authenticated; select public.start_conversation('{recipient}'); "
                   "select pg_sleep(0.3); commit;", check=False)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(start_pair, [(users[0], users[1]), (users[1], users[0])]))
    assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
    returned = []
    for result in results:
        values = []
        for line in result.stdout.splitlines():
            try:
                values.append(str(uuid.UUID(line)))
            except ValueError:
                pass
        assert len(values) == 1, result.stdout
        returned.append(values[0])
    assert returned[0] == returned[1], returned
    active = sql(f"select count(*) from public.conversations where '{users[0]}' in(user_low_id,user_high_id) and status='active';").stdout.strip()
    assert active == "1", active
    print("PASS: simultaneous direct starts from both sides reuse one immediately active room.")
finally:
    sql(f"begin; delete from public.notifications where user_id in ({ids}) or actor_id in ({ids}); "
        f"delete from public.conversations where user_low_id in ({ids}) or user_high_id in ({ids}); "
        f"delete from private.action_rate_events where user_id in ({ids}); "
        f"delete from auth.users where id in ({ids}); commit;")

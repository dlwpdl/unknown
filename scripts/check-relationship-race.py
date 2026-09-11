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


users = [str(uuid.uuid4()) for _ in range(5)]
rooms = [str(uuid.uuid4()) for _ in range(4)]
ids = ",".join("'" + user + "'" for user in users)
claims = json.dumps({"sub": users[0], "role": "authenticated"})
try:
    for index, user in enumerate(users):
        sql(f"insert into auth.users(id,email) values('{user}','{user}@race.invalid'); "
            f"insert into public.profiles(id,nickname,city_id) values('{user}','경쟁검증{user[:8]}','vancouver');")
    for index, peer in enumerate(users[1:]):
        low, high = sorted([users[0], peer])
        sql(f"insert into public.conversations(id,user_low_id,user_high_id,status,requester_id) "
            f"values('{rooms[index]}','{low}','{high}','{'active' if index < 2 else 'pending'}','{peer}');")

    def accept(room):
        return sql(f"begin; set local statement_timeout='10s'; select set_config('request.jwt.claims','{claims}',true); "
                   f"set local role authenticated; select public.respond_direct_conversation('{room}','accepted'); "
                   "select pg_sleep(0.3); commit;", check=False)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, rooms[2:]))
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    assert any("CONVERSATION_LIMIT_REACHED" in result.stderr for result in results)
    active = sql(f"select count(*) from public.conversations where '{users[0]}' in(user_low_id,user_high_id) and status='active';").stdout.strip()
    assert active == "3", active
    print("PASS: concurrent last-slot acceptance commits once; losing request stays pending.")
finally:
    sql(f"begin; delete from public.notifications where user_id in ({ids}) or actor_id in ({ids}); "
        f"delete from public.conversations where user_low_id in ({ids}) or user_high_id in ({ids}); "
        f"delete from private.action_rate_events where user_id in ({ids}); "
        f"delete from auth.users where id in ({ids}); commit;")

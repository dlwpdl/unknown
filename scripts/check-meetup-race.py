"""Local-only: python3 scripts/check-meetup-race.py (uses the existing disposable DB)."""
import concurrent.futures
import json
import subprocess
import uuid


def sql(statement, check=True):
    return subprocess.run(
        ["docker", "exec", "-i", "supabase_db_gling", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=check,
    )


user = str(uuid.uuid4())
claims = json.dumps({"sub": user, "role": "authenticated"})
create = "public.create_chilling_event('vancouver','경쟁 검증','로컬 테스트',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문')"
login = f"select set_config('request.jwt.claims','{claims}',true); set local role authenticated;"
try:
    sql(f"insert into auth.users(id,email) values('{user}','{user}@race.invalid'); "
        f"insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) "
        f"values('{user}','개최경쟁{user[:8]}','vancouver',now(),now(),now(),'test');")
    sql(f"begin; {login} select public.save_chilling_profile('{{\"intro\":\"소개\",\"interests\":[\"산책\"],\"promptOne\":\"바다\",\"promptTwo\":\"주말\"}}'); "
        f"select public.leave_meetup({create}); select public.leave_meetup({create}); commit;")

    def attempt(_):
        return sql(f"begin; set local statement_timeout='10s'; {login} select {create}; select pg_sleep(0.3); commit;", check=False)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sum(result.returncode == 0 for result in results) == 1, [result.stderr for result in results]
    assert any("CHILLING_CREATE_LIMIT" in result.stderr for result in results)
    assert sql(f"select count(*) from private.meetup_activity where user_id='{user}' and action='create'").stdout.strip() == "3"
    print("PASS: concurrent third/fourth hosting requests commit exactly once; failed request leaves no post.")
    assert sql(f"select count(*) from public.posts where author_id='{user}'").stdout.strip() == "3"
finally:
    sql(f"begin; delete from public.notifications where user_id='{user}' or actor_id='{user}'; "
        f"delete from public.safety_review_queue where target_id in(select id from public.posts where author_id='{user}') or target_id='{user}'; "
        f"delete from public.conversations where group_post_id in(select id from public.posts where author_id='{user}'); "
        f"delete from public.posts where author_id='{user}'; delete from private.action_rate_events where user_id='{user}'; "
        f"delete from auth.users where id='{user}'; commit;")

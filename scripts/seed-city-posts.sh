#!/bin/bash
# 도시 게시글 자동 등록. content/<날짜>/posts.json 을 읽어 운영 DB에 넣는다.
#
# 원고는 사람이나 에이전트가 미리 쓴다. 이 스크립트는 넣는 일만 한다.
#   - 원고에서 먼저 지정한 도시별 기존 프로필을 재사용한다 (새 프로필을 만들지 않는다)
#   - 시드 계정만 쓴다. 운영자·테스터 같은 실제 계정에는 대신 쓰지 않는다
#   - 프로필 도시와 글 도시를 섞지 않는다
#   - 예약은 실제 시간이 된 원고 한 건만, 실제 현재 시각으로 등록한다
#   - 새 글 조회수는 0에서 시작한다
#   - 같은 도시에 같은 제목이 이미 있으면 그 줄은 건너뛴다 (재실행 안전)
#
# 사용법:
#   scripts/seed-city-posts.sh            # 오늘 날짜로 등록
#   scripts/seed-city-posts.sh 2026-09-22 # 날짜 지정
#   DRY_RUN=1 scripts/seed-city-posts.sh  # SQL만 출력
#   STAGE=1 scripts/seed-city-posts.sh    # 원고를 launchd가 읽을 수 있는 위치로 복사
#   SCHEDULED=1 STAGE=1 scripts/seed-city-posts.sh # 도시별 일반5건+사연1건의 실제 게시 시각 준비
#   DUE=1 scripts/seed-city-posts.sh      # 기존 예약 큐에서 시간이 된 한 건만 등록
#   GROW=1 scripts/seed-city-posts.sh     # 원고·게시 없이 현재 구간의 행정 조회수만 증가
#
# launchd는 macOS 권한 때문에 ~/Desktop을 읽지 못한다. 그래서 예약 실행은
# ~/Library/Application Support/gling/city-posts/ 아래에 복사된 스크립트와 원고를 쓴다.
set -uo pipefail

export PATH="/Users/ash/.nvm/versions/node/v22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="$HOME/Desktop/Git/unknown/mobile"
PROJECT_REF="wjvahbdwmctzpkndqaxa"
DAY="${1:-$(TZ=America/Vancouver date +%F)}"
LOG_DIR="${CITY_POSTS_DIR:-$HOME/Library/Application Support/gling/city-posts}"
PAYLOAD_DIR="$LOG_DIR/payload"
REPO_FILE="$REPO/content/$DAY/posts.json"
STAGED_FILE="$PAYLOAD_DIR/$DAY.json"
SCHEDULE="$(dirname "$0")/city-post-schedule.py"
RECEIPT="${APP_RECEIPT:-$LOG_DIR/receipts/$DAY.json}"

mkdir -p "$PAYLOAD_DIR"

# 원고를 예약 실행이 읽을 수 있는 위치로 복사한다. 원고를 쓴 직후 한 번 돌린다.
if [ "${STAGE:-0}" = "1" ]; then
  SOURCE="${POSTS_FILE:-$REPO_FILE}"
  if [ ! -f "$SOURCE" ]; then echo "SKIP $SOURCE 없음"; exit 1; fi
  if [ "${SCHEDULED:-0}" = "1" ]; then
    python3 "$SCHEDULE" stage "$SOURCE" "$STAGED_FILE" "$DAY" "$REPO/marketing/community-story-sources.json" || exit 1
  else
    python3 "$SCHEDULE" stage-raw "$SOURCE" "$STAGED_FILE" || exit 1
  fi
  echo "STAGED $STAGED_FILE"
  exit 0
fi

if [ "${DRY_RUN:-0}" != "1" ]; then exec >>"$LOG_DIR/$DAY.log" 2>&1; fi
echo "=== $(date) 도시 게시글 처리 시작 ($DAY)"

# 같은 5분 tick에서 별도 요청으로 갱신한다. 원고·영수증·게시 실패와 독립적이다.
if [ "${DUE:-0}" = "1" ] && [ "${GROW:-0}" != "1" ]; then
  DUE=0 GROW=1 /bin/bash "$0" "$DAY" || echo "WARN 행정 조회수 갱신 실패. 예약 게시 검사는 계속한다."
fi

SQL_FILE="$(mktemp "${TMPDIR:-/tmp}/gling-city-posts.XXXXXX")" || exit 1
trap 'rm -f "$SQL_FILE"' EXIT

if [ "${GROW:-0}" = "1" ]; then
  cat > "$SQL_FILE" <<'GROW'
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '20s';
-- 실제 독자가 아닌 행정 증가다. 지나간 구간은 보충하지 않고 현재 구간에 최대1만 더한다.
with locked as materialized (
  select p.id, slot.bucket,
         floor(extract(epoch from (slot.bucket - p.created_at)) / 86400)::int as elapsed,
         floor(extract(epoch from (slot.bucket - p.created_at)) / 600)::int % 144 as tick
  from public.posts p
  cross join (select date_bin(interval '10 minutes', now(), '2000-01-01'::timestamptz) as bucket) slot
  where p.status = 'published' and p.deleted_at is null
    and p.view_count < 100000000
    and p.city_id in ('toronto', 'vancouver', 'montreal', 'calgary', 'edmonton')
    and p.created_at < slot.bucket and p.created_at > now() - interval '30 days'
  order by p.id
  for no key update of p skip locked
), new_pulse as (
  insert into private.post_view_pulse (post_id, bucket, views)
  select base.id, base.bucket, 1 from locked base
  where exists (
    -- 기존 일별1~30/1~8 해시를144구간에 분산한다. 55와144는 서로소라 구간이 겹치지 않는다.
    select 1 from generate_series(0,
      (abs(hashtext(base.id::text || '-' || base.elapsed)::bigint)
       % (case when base.elapsed <= 13 then 30 else 8 end))::int) as day(i)
    where (abs(hashtext(base.id::text || '-slot-' || base.elapsed)::bigint) + day.i * 55) % 144 = base.tick
  )
  on conflict on constraint post_view_pulse_pkey do nothing
  returning post_id
), increased as (
  update public.posts post set view_count = post.view_count + 1
  from new_pulse where post.id = new_pulse.post_id
    and post.status = 'published' and post.deleted_at is null
  returning post.id
)
select 'administrative_growth' as kind, count(*) as posts_updated,
       count(*) as administrative_views_added
from increased;
commit;
GROW
else
FILE="${POSTS_FILE:-}"
if [ "${DUE:-0}" = "1" ]; then
  FILE="${POSTS_FILE:-$STAGED_FILE}"
fi
# launchd는 ~/Desktop 파일을 stat은 하되 열지는 못한다. 권한 비트(-r)로는 구분되지 않으므로
# 실제로 한 바이트를 열어보고, 열리지 않으면 예약 실행용 사본을 쓴다.
if [ -z "$FILE" ] && [ -f "$REPO_FILE" ] && head -c 1 "$REPO_FILE" >/dev/null 2>&1; then
  FILE="$REPO_FILE"
fi
[ -n "$FILE" ] || FILE="$STAGED_FILE"

if [ ! -f "$FILE" ]; then
  echo "SKIP $FILE 없음. 오늘 원고가 아직 없어 등록하지 않는다."
  exit 0
fi

if [ "${DUE:-0}" = "1" ]; then
  PAYLOAD="$(python3 "$SCHEDULE" due "$FILE" "$DAY" "$RECEIPT")" || exit 1
else
  PAYLOAD="$(jq -c '.posts' "$FILE")" || exit 1
fi
COUNT="$(printf '%s' "$PAYLOAD" | jq 'length')" || exit 1
if [ -z "$PAYLOAD" ] || [ "${COUNT:-0}" = "0" ]; then
  echo "SKIP 지금 게시할 새 원고가 없다."
  exit 0
fi
if [[ "$PAYLOAD" == *'$GLING$'* ]]; then
  echo "FAIL INVALID_SQL_DELIMITER" >&2
  exit 1
fi
if [ "$COUNT" -lt 1 ]; then
  echo "SKIP 원고 0건."
  exit 0
fi
printf '%s' "$PAYLOAD" | python3 "$SCHEDULE" validate-stories || exit 1
if ! jq -e '.posts | all(.[]; (.author_nickname | type) == "string" and (.author_nickname | length) > 0)' "$FILE" >/dev/null; then
  echo "FAIL 각 글에 author_nickname을 지정해야 한다." >&2
  exit 1
fi

{
  cat <<'HEAD'
begin;
create temporary table gling_today (
  ord integer, city_id text, author_nickname text, tag_slug text, title text, body text, source text,
  content_kind text, poll jsonb, story_fit jsonb, post_id uuid
) on commit drop;
insert into gling_today (ord, city_id, author_nickname, tag_slug, title, body, source, content_kind, poll, story_fit, post_id)
select item.ord, item.city_id, item.author_nickname, item.tag_slug, item.title, item.body, item.source, item.content_kind, item.poll, item.story_fit, item.post_id
from jsonb_to_recordset(
HEAD
  printf '$GLING$%s$GLING$::jsonb' "$PAYLOAD"
  cat <<'TAIL'
) as item(ord int, city_id text, author_nickname text, tag_slug text, title text, body text, source text, content_kind text, poll jsonb, story_fit jsonb, post_id uuid);
create temporary table gling_today_author on commit drop as
select slot.city_id, slot.author_nickname,
       (select pr.id
        from public.profiles pr
        join auth.users u on u.id = pr.id
        where pr.city_id = slot.city_id
          and pr.nickname = slot.author_nickname
          and pr.account_status = 'active'
          and u.email like '%@seed.gling.invalid'
          and coalesce(u.raw_app_meta_data->>'role','')<>'admin'
          and u.raw_app_meta_data->'review_access' is distinct from 'true'::jsonb
          and not exists(select 1 from private.personal_info info where info.user_id=pr.id)) as author_id
from (select distinct city_id, author_nickname from gling_today) slot;
do $$ begin
  if exists (select 1 from gling_today_author where author_id is null) then
    raise exception 'SEED_AUTHOR_NOT_FOUND';
  end if;
  if exists (select 1 from gling_today_author a join auth.users u on u.id=a.author_id join public.profiles p on p.id=a.author_id
    where u.raw_app_meta_data->'gling_persona'->>'version' is distinct from '4'
      or u.raw_app_meta_data->'gling_persona'->>'profile_id' is distinct from a.author_id::text
      or u.raw_app_meta_data->'gling_persona'->>'city_id' is distinct from a.city_id
      or u.raw_app_meta_data->'gling_persona'->>'kind' is distinct from 'gling_operated_character'
      or not (coalesce(u.raw_app_meta_data->'gling_persona','{}'::jsonb) ?& array['living','background','values','personality','interests','writing_purpose','voice','continuity'])
      or coalesce(p.bio,'') not like '글링 운영 캐릭터%') then
    raise exception 'SEED_PERSONA_NOT_FOUND';
  end if;
end $$;
do $$ begin
  if exists(select 1 from gling_today seed join gling_today_author a using(city_id,author_nickname)
    join public.posts p on p.id=seed.post_id where p.city_id is distinct from seed.city_id
    or p.author_id is distinct from a.author_id or p.title is distinct from seed.title or p.body is distinct from seed.body)
    or exists(select 1 from gling_today where post_id is not null group by post_id having count(*)>1) then
    raise exception 'STORY_POST_ID_ALREADY_BOUND_TO_OTHER_CONTENT';
  end if;
  if exists(select 1 from gling_today seed join gling_today_author a using(city_id,author_nickname)
    join auth.users u on u.id=a.author_id where seed.content_kind='community_story' and (
      u.raw_app_meta_data->'gling_persona'->'editorial_role'->>'kind' is distinct from 'community_story_poll'
      or seed.story_fit->>'profile_id' is distinct from a.author_id::text
      or seed.story_fit->'family' is distinct from u.raw_app_meta_data->'gling_persona'->'family'
      or not coalesce(u.raw_app_meta_data->'gling_persona'->'editorial_role'->'topics' ? (seed.story_fit->>'topic'),false))) then
    raise exception 'STORY_PERSONA_FAMILY_OR_TOPIC_MISMATCH';
  end if;
end $$;
with inserted as (
insert into public.posts (id, author_id, city_id, tag_id, title, body, status, view_count, created_at)
select coalesce(seed.post_id,gen_random_uuid()), a.author_id, seed.city_id, tag.id, seed.title,
       seed.body,
       'published',
       0,
       now()
from gling_today seed
join gling_today_author a on a.city_id = seed.city_id and a.author_nickname = seed.author_nickname
join public.tags tag on tag.slug = seed.tag_slug
join public.cities city on city.id = seed.city_id
where not exists (
  select 1 from public.posts existing
  where existing.city_id = seed.city_id and existing.title = seed.title and existing.status = 'published')
on conflict (id) do nothing
returning id,city_id,author_id,title)
insert into public.post_polls(post_id,question,options)
select inserted.id,btrim(seed.poll->>'question'),
       array(select btrim(v) from jsonb_array_elements_text(seed.poll->'options') v)
from inserted join gling_today seed on seed.city_id=inserted.city_id and seed.title=inserted.title
join gling_today_author a on a.city_id=seed.city_id and a.author_nickname=seed.author_nickname and a.author_id=inserted.author_id
where seed.poll is not null;

-- 실제 등록 시각의 도시 현지 날짜를 쓴다.
update public.posts post
set posted_on = (post.created_at at time zone city.timezone)::date
from public.cities city, gling_today seed, gling_today_author author
where city.id = post.city_id
  and seed.city_id = post.city_id
  and seed.title = post.title
  and author.city_id = seed.city_id
  and author.author_nickname = seed.author_nickname
  and post.author_id = author.author_id
  and post.posted_on <> (post.created_at at time zone city.timezone)::date;

TAIL
} > "$SQL_FILE"

cat >> "$SQL_FILE" <<'PULSE'
insert into private.post_view_pulse (post_id, bucket, views)
select p.id, date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz), p.view_count
from public.posts p
join gling_today seed on seed.title = p.title and seed.city_id = p.city_id
join gling_today_author author on author.city_id = seed.city_id
  and author.author_nickname = seed.author_nickname and author.author_id = p.author_id
where p.status = 'published'
  and not exists (select 1 from private.post_view_pulse x where x.post_id = p.id);
commit;
PULSE

if [ "${DUE:-0}" = "1" ] || [ -n "${APP_RECEIPT:-}" ]; then
  # COMMIT 뒤 실제 저장된 글을 읽어야 성공 영수증을 남길 수 있다.
  WANTED="$(printf '%s' "$PAYLOAD" | jq -c '[.[] | {city_id,title,author_nickname}]')" || exit 1
  printf '\nselect p.id, p.city_id, p.title, p.created_at, author.nickname as author_nickname from public.posts p join jsonb_to_recordset($GLING$%s$GLING$::jsonb) as wanted(city_id text, title text, author_nickname text) on wanted.city_id=p.city_id and wanted.title=p.title join public.profiles author on author.id=p.author_id and author.city_id=wanted.city_id and author.nickname=wanted.author_nickname join auth.users seed_user on seed_user.id=author.id and seed_user.email like \x27%%@seed.gling.invalid\x27 where p.status=\x27published\x27;\n' "$WANTED" >> "$SQL_FILE"
fi
fi

if [ "${DRY_RUN:-0}" = "1" ]; then cat "$SQL_FILE"; exit 0; fi

# 연결은 Supabase Management API로 한다. 키체인의 CLI 토큰을 그대로 쓴다.
TOKEN="$(security find-generic-password -s 'Supabase CLI' -w 2>/dev/null)"
if [ -z "$TOKEN" ]; then
  echo "FAIL Supabase CLI 토큰을 키체인에서 읽지 못했다."
  exit 1
fi

if [ "${GROW:-0}" != "1" ] && { [ "${DUE:-0}" = "1" ] || [ -n "${APP_RECEIPT:-}" ]; }; then
  python3 "$SCHEDULE" attempt "$RECEIPT" "$PAYLOAD" || exit 1
fi

RESULT="$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1], encoding="utf-8").read()}, ensure_ascii=True))' "$SQL_FILE" | curl --fail-with-body -sS --connect-timeout 10 --max-time 25 -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @-)" || {
    if [ "${GROW:-0}" = "1" ]; then
      echo "FAIL 행정 조회수 전송·저장 결과 미확인. 다음 정상 구간만 처리한다."
    else
      echo "FAIL HTTP 전송·저장 결과 미확인. 예약 attempted 영수증은 보존하며 다시 보내지 않는다."
    fi
    exit 1
  }

if ! printf '%s' "$RESULT" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "FAIL $RESULT"
  exit 1
fi
if [ "${GROW:-0}" != "1" ] && { [ "${DUE:-0}" = "1" ] || [ -n "${APP_RECEIPT:-}" ]; }; then
  printf '%s' "$RESULT" | python3 "$SCHEDULE" confirm "$RECEIPT" "$PAYLOAD" || exit 1
fi
if [ "${GROW:-0}" = "1" ]; then
  echo "OK 행정 조회수 구간 증가 (실제 독자 수와 별도) $RESULT"
else
  echo "OK ${COUNT}건 처리 $RESULT"
fi

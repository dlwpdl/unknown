"""저장소·송출 여유를 확인한다: python3 scripts/storage-usage.py

무료 플랜은 저장 1GB, 송출 5GB/월이다. 저장이 300MB를 넘으면 경고, 600MB를 넘으면 실패로 끝나서
예약 실행이 알려줄 수 있게 한다. 송출은 Management API 조회 경로가 없어 대시보드에서 봐야 하고,
여기서는 측정한 평균 용량으로 남은 조회 가능량을 계산해 보여준다.
"""
import json
import subprocess
import sys
import urllib.request

PROJECT_REF = "wjvahbdwmctzpkndqaxa"
FREE_STORAGE_BYTES = 1_000_000_000
FREE_EGRESS_BYTES = 5_000_000_000
WARN_BYTES = 300_000_000
ALERT_BYTES = 600_000_000
BUCKET_SQL = (
    "select bucket_id, count(*) as objects, coalesce(sum((metadata->>'size')::bigint), 0) as bytes,"
    " coalesce(round(avg((metadata->>'size')::bigint)), 0) as avg_bytes"
    " from storage.objects group by bucket_id order by bytes desc"
)
LARGEST_SQL = (
    "select bucket_id, name, (metadata->>'size')::bigint as bytes"
    " from storage.objects order by (metadata->>'size')::bigint desc limit 5"
)


def token():
    # 토큰은 키체인에서 읽는다. 어디에도 출력하지 않는다.
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def query(sql, access_token):
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if isinstance(payload, dict) and payload.get("message"):
        raise SystemExit(payload["message"])
    return payload


def pretty(size):
    return f"{size / 1_000_000:.1f}MB"


def main():
    access_token = token()
    buckets = query(BUCKET_SQL, access_token)
    largest = query(LARGEST_SQL, access_token)
    total = sum(int(row["bytes"] or 0) for row in buckets)
    objects = sum(int(row["objects"] or 0) for row in buckets)
    average = total / objects if objects else 0
    print(f"저장 {pretty(total)} / 무료 1.0GB ({total / FREE_STORAGE_BYTES * 100:.1f}%) · 객체 {objects}개 · 평균 {pretty(average)}")
    for row in buckets:
        print(f"  - {row['bucket_id']}: {row['objects']}개, {pretty(int(row['bytes'] or 0))}, 평균 {pretty(int(row['avg_bytes'] or 0))}")
    if largest:
        print("가장 큰 객체:")
        for row in largest:
            print(f"  - {row['bucket_id']}/{row['name']} {pretty(int(row['bytes'] or 0))}")
    if average:
        print(f"송출 5GB 기준 남은 조회 가능량: 약 {int(FREE_EGRESS_BYTES // average):,}회 (평균 {pretty(average)} 기준, 실제 송출은 대시보드 확인)")
    if total >= ALERT_BYTES:
        print(f"ALERT: 저장이 {pretty(ALERT_BYTES)}를 넘었습니다. 해상도·장수를 줄이거나 유료 플랜/외부 스토리지를 검토하세요.")
        return 1
    if total >= WARN_BYTES:
        print(f"WARN: 저장이 {pretty(WARN_BYTES)}를 넘었습니다. 송출 추이를 함께 보세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

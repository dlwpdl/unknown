#!/bin/bash
# 글링 운영 DB 백업. Supabase 무료 플랜에는 자동 백업과 시점 복구가 없어서 직접 받아둔다.
#
# 받는 것: public 스키마 구조와 데이터, auth 스키마 데이터(이게 없으면 아무도 로그인 못 한다).
# 받지 않는 것: Storage 의 업로드 사진. 용량이 커서 여기 넣지 않는다.
#
# 파일에는 이메일과 대화 내용이 들어 있다. 자격증명과 같은 자리에 두고 git 에는 넣지 않는다.
set -uo pipefail

# launchd 는 최소한의 PATH 로 실행한다. node 를 못 찾으면 조용히 실패하므로 여기서 박아둔다.
export PATH="/Users/ash/.nvm/versions/node/v22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="$HOME/Desktop/Git/unknown/mobile"
OUT="$HOME/Library/Application Support/gling/backups"
KEEP=8  # 최근 8회분만 남긴다
STAMP="$(date +%Y-%m-%d-%H%M)"
DIR="$OUT/$STAMP"

cd "$REPO" || exit 1
mkdir -p "$DIR"
LOG="$DIR/backup.log"
exec >>"$LOG" 2>&1
echo "=== $(date) 백업 시작"

dump() {
  local label="$1" file="$2"; shift 2
  if npx --no-install supabase db dump --linked "$@" -f "$DIR/$file" < /dev/null; then
    gzip -f "$DIR/$file"
    echo "OK $label $(wc -c < "$DIR/$file.gz") bytes"
  else
    echo "FAIL $label"
    return 1
  fi
}

failed=0
dump "구조" schema.sql || failed=1
dump "데이터" data.sql --data-only || failed=1
dump "로그인" auth.sql --schema auth --data-only || failed=1

# 빈 덤프는 성공으로 치지 않는다. 조용히 비어 있는 백업이 가장 위험하다.
for f in schema.sql.gz data.sql.gz auth.sql.gz; do
  if [ ! -s "$DIR/$f" ] || [ "$(wc -c < "$DIR/$f")" -lt 200 ]; then
    echo "FAIL $f 가 비었거나 너무 작다"; failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "=== 실패. 폴더를 남겨 원인을 확인한다: $DIR"
  exit 1
fi

# 오래된 백업 정리. macOS 의 head 는 음수 줄 수를 받지 못하므로 최신순 + tail 로 센다.
ls -1dt "$OUT"/20*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  echo "정리: $old"; rm -rf "$old"
done

echo "=== 완료 $(du -sh "$DIR" | cut -f1)"

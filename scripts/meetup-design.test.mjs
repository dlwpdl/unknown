import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('모임 탭은 헤더를 목록 밖에 고정하고 필터를 한 줄 + 시트로 접는다', () => {
  const meetups = read('src/app/(tabs)/meetups.tsx');
  assert.ok(meetups.indexOf('styles.headFixed') < meetups.indexOf('<FlatList'), '헤더는 목록 밖(위)에 있어야 스크롤해도 남는다');
  assert.ok(meetups.includes('app_tabs_meetups.pressable.14'), '필터 여는 버튼이 있어야 한다');
  assert.ok(meetups.includes('app_tabs_meetups.switch.1'), '자리 남음은 칩이 아니라 스위치로 둔다');
  assert.ok(!meetups.includes('pressable.11'), '한 줄에 섞여 있던 자리 남음 칩은 없어야 한다');
  // 선택 색은 홈과 같은 브랜드 레드 하나로 통일한다(검정 선택 칩은 홈과 어긋났다).
  assert.ok(meetups.includes('category === value ? theme.accent : theme.line'), '분위기 선택은 브랜드 색을 쓴다');
});

test('목록·대화·알림의 빈 상태와 오류는 같은 카드 규격을 쓴다', () => {
  for (const path of ['src/app/(tabs)/meetups.tsx', 'src/app/(tabs)/chat.tsx', 'src/app/(tabs)/notifications.tsx']) {
    assert.ok(read(path).includes("from '@/components/state-card'"), path);
  }
  const card = read('src/components/state-card.tsx');
  assert.ok(card.includes("kind === 'error' ? 'warning' : 'selection'"), '빈 상태와 오류는 다른 소리로 구분한다');
  assert.ok(card.includes('actionLabel'), '상태 카드는 다음 행동을 함께 제시한다');
});

test('모임 프로필은 사진·작성 예시·관심사 태그·미리보기를 포함한다', () => {
  const profile = read('src/app/meetup-profile.tsx');
  assert.ok(profile.includes('app_meetup-profile.pressable.5'), '사진 선택 컨트롤');
  assert.ok(profile.includes('app_meetup-profile.pressable.4'), '작성 예시를 눌러 채우는 프롬프트 칩');
  assert.ok(profile.includes('app_meetup-profile.pressable.6') && profile.includes('app_meetup-profile.pressable.7'), '관심사 태그 추가·삭제');
  assert.ok(profile.includes('<ChillingProfileCard profile={{ ...profile, interests: tags }} identity={me} />'), '계정 정보와 모임용 내용을 함께 미리 보여준다');
  assert.ok(profile.includes('필수 항목'), '저장에 필요한 항목의 작성 상태 표시');
});

test('멤버십은 사용 현황·이용 규칙·플랜 비교 순서로 묶고 관리자는 제한 없음으로 보여준다', () => {
  const membership = read('src/app/profile/membership.tsx');
  const order = ['사용 현황', '이용 규칙', '플랜 비교'].map((title) => membership.indexOf(title));
  assert.ok(order.every((index) => index > -1) && order[0] < order[1] && order[1] < order[2], '섹션 순서가 사용 현황 → 이용 규칙 → 플랜 비교여야 한다');
  assert.ok(membership.includes('관리자 계정 · 제한 없음'), '관리자는 숫자 대신 제한 없음을 본다');
});

test('관리자 콘솔은 사람을 ID가 아니라 이름으로 보여준다', () => {
  const queue = read('src/components/admin/admin-report-queue.tsx');
  assert.ok(queue.includes('displayName(profiles.get(report.reporter_id), report.reporter_id)'), '신고자도 이름으로');
  assert.ok(queue.includes('원본 ID 보기'), '원본 ID는 접어 두고 필요할 때만 연다');
});

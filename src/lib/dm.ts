// mock DM 요청 상태 — 앱 세션 동안 유지. Supabase 연결 시 dm_requests(pending) 조회로 교체.
// key는 mock 단계라 닉네임 사용 (실구현은 user id).
const requested = new Set<string>();

export const dmRequests = {
  has: (nickname: string) => requested.has(nickname),
  add: (nickname: string) => {
    requested.add(nickname);
  },
  // 취소 = pending 해제 → 슬롯 즉시 반환 (실구현: cancel_dm_request RPC, status='canceled')
  remove: (nickname: string) => {
    requested.delete(nickname);
  },
};

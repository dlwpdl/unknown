// mock 조회 — 상세 진입 시 1회 기록(유니크). Supabase 연결 시 record_view RPC로 교체.
const viewed = new Set<string>();

export const views = {
  has: (postId: string) => viewed.has(postId),
  mark: (postId: string) => {
    viewed.add(postId);
  },
  unmark: (postId: string) => {
    viewed.delete(postId);
  },
};

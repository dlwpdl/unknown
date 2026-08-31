// mock 공감(좋아요) — Supabase 연결 시 reactions(kind='like')로 교체.
const liked = new Set<string>();

export const likes = {
  has: (postId: string) => liked.has(postId),
  toggle: (postId: string) => {
    if (liked.has(postId)) liked.delete(postId);
    else liked.add(postId);
    return liked.has(postId);
  },
};

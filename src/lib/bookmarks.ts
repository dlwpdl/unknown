// mock 북마크 — 앱 세션 동안 유지. Supabase 연결 시 reactions(kind='save')로 교체.
const saved = new Set<string>();

export const bookmarks = {
  has: (postId: string) => saved.has(postId),
  toggle: (postId: string) => {
    if (saved.has(postId)) saved.delete(postId);
    else saved.add(postId);
    return saved.has(postId);
  },
};

import type { Post } from './types.ts';

// 목록 카드에서 글을 열면 그 카드의 글을 글 화면 첫 프레임에 그대로 보여 준다(빈 화면·로딩 없이). owner 2026-11-02.
let handedOff: { viewer: string; post: Post } | null = null;
export function handOffPost(viewer: string, post: Post) { handedOff = { viewer, post }; }
export function handedOffPost(viewer: string, id: string) {
  return handedOff?.viewer === viewer && handedOff.post.id === id ? handedOff.post : undefined;
}
// 받은 화면이 지운다. 남겨 두면 나중에 같은 글을 딥링크로 열 때 예전 목록 값이 보인다.
export function forgetHandedOffPost(id: string) { if (handedOff?.post.id === id) handedOff = null; }

// 글 화면에서 바뀐 것(수정·삭제·댓글 수·조회 수)을 그 글을 연 목록에 알린다. 예전 홈 시트의 콜백과 같은 결과.
export const POST_CHANGED_EVENT = 'postChanged';
export type PostChange = { id: string; removed?: true; post?: Post; views?: number; comments?: number };
export function applyPostChange(posts: Post[], { id, removed, post, ...counts }: PostChange): Post[] {
  if (removed) return posts.filter(item => item.id !== id);
  return posts.map(item => item.id !== id ? item : post ?? { ...item, ...counts });
}

import type { PostComment } from './types.ts';

export type CommentListRow =
  | { key: string; type: 'label'; label: 'focus' | 'focus-reply' }
  | { key: string; type: 'comment'; comment: PostComment; depth: 'root' | 'reply' | 'focus-reply'; focusTarget?: boolean; sectionStart?: boolean }
  | { key: string; type: 'toggle'; comment: PostComment }
  | { key: string; type: 'page'; parentId: string | null; sectionStart?: boolean }
  | { key: string; type: 'focus-status'; status: 'loading' | 'error' | 'hidden' }
  | { key: string; type: 'focus-retry' }
  | { key: string; type: 'empty' };

type BuildCommentListRowsOptions = {
  comments: PostComment[];
  expanded: Set<string>;
  focusedCommentId?: string;
  focusedComments?: PostComment[];
  focusStatus?: 'loading' | 'ready' | 'error' | 'hidden';
  rootPageLoaded: boolean;
};

export function buildCommentListRows({ comments, expanded, focusedCommentId, focusedComments, focusStatus, rootPageLoaded }: BuildCommentListRowsOptions) {
  const rows: CommentListRow[] = [];
  const roots: PostComment[] = [];
  const repliesByRoot = new Map<string, PostComment[]>();
  for (const comment of comments) {
    if (!comment.parentId) roots.push(comment);
    else {
      const replies = repliesByRoot.get(comment.parentId) ?? [];
      replies.push(comment);
      repliesByRoot.set(comment.parentId, replies);
    }
  }

  const focusedRoot = focusedComments?.find((comment) => !comment.parentId);
  const focusedReply = focusedComments?.find((comment) => comment.id === focusedCommentId && comment.parentId);

  const addThread = (root: PostComment, target?: PostComment, focused = false) => {
    rows.push({ key: `comment:${root.id}`, type: 'comment', comment: root, depth: 'root', focusTarget: focused, sectionStart: !focused });
    if (target && expanded.has(root.id)) {
      rows.push({ key: `focus-reply-label:${target.id}`, type: 'label', label: 'focus-reply' });
      rows.push({ key: `comment:${target.id}`, type: 'comment', comment: target, depth: 'focus-reply' });
    }
    if ((root.replyCount ?? 0) > 0 || expanded.has(root.id)) rows.push({ key: `toggle:${root.id}`, type: 'toggle', comment: root });
    if (expanded.has(root.id)) {
      const replies = (repliesByRoot.get(root.id) ?? []).filter((reply) => reply.id !== target?.id);
      for (const [index, reply] of replies.entries()) {
        rows.push({ key: `comment:${reply.id}`, type: 'comment', comment: reply, depth: 'reply', sectionStart: index === 0 });
      }
      rows.push({ key: `page:${root.id}`, type: 'page', parentId: root.id, sectionStart: replies.length === 0 });
    }
  };

  if (focusStatus) {
    rows.push({ key: 'focus-label', type: 'label', label: 'focus' });
    if (focusedRoot) addThread(focusedRoot, focusedReply, true);
    else if (focusStatus !== 'ready') rows.push({ key: 'focus-status', type: 'focus-status', status: focusStatus });
    else rows.push({ key: 'focus-status', type: 'focus-status', status: 'hidden' });
    if (focusStatus === 'error') rows.push({ key: 'focus-retry', type: 'focus-retry' });
  }

  for (const root of roots) {
    if (root.id !== focusedRoot?.id) addThread(root);
  }
  if (rootPageLoaded && comments.length === 0) rows.push({ key: 'empty', type: 'empty' });
  rows.push({ key: 'page:roots', type: 'page', parentId: null, sectionStart: comments.length === 0 && !focusStatus && !rootPageLoaded });
  return rows;
}

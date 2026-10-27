// Pure helpers for the bell list: tab split, grouping, sections and paging. No React/Supabase imports so node tests load it directly.
export type InboxRow = {
  id: string; kind: string; category: string; body: string; title?: string | null; route: string | null;
  read_at: string | null; created_at: string; actor_id?: string | null; target_type?: string | null; target_id?: string | null;
};
export type InboxTab = 'mine' | 'city' | 'admin';
export type InboxItem<T extends InboxRow = InboxRow> = { key: string; kind: 'single' | 'likes' | 'hashtag'; lead: T; rows: T[] };

export const NOTIFICATION_PAGE_SIZE = 50;
const CITY_CATEGORIES = new Set(['trending', 'weekly_ranking', 'city_food', 'city_places', 'interests', 'nearby']);
const CITY_KINDS = new Set(['trending_meetup', 'trending_hashtag']);
const LIKE_KINDS = new Set(['post_like', 'comment_like', 'like_summary']);
// Chat-request kinds stay unread in the bell so the chat tab badge keeps counting them until the request is opened.
export const BELL_KEEP_UNREAD_KINDS = new Set(['meetup_request', 'meetup_approved', 'meetup_rejected']);
export const isAdminKind = (kind: string) => kind === 'safety_alert' || kind.startsWith('admin_');

/** Which bell tab a row belongs to; messages live only in the chat tab. */
export function inboxTab(row: Pick<InboxRow, 'kind' | 'category'>, adminAccount = false): InboxTab | null {
  if (row.kind === 'message') return null;
  if (adminAccount && isAdminKind(row.kind)) return 'admin';
  return CITY_CATEGORIES.has(row.category) || CITY_KINDS.has(row.kind) ? 'city' : 'mine';
}

export function hashtagOf(row: Pick<InboxRow, 'kind' | 'route' | 'body'>): string | null {
  if (row.kind !== 'trending_hashtag') return null;
  const routed = /^\/\?hashtag=([^&?#]+)$/.exec(row.route ?? '');
  if (routed) { try { return decodeURIComponent(routed[1]).toLowerCase(); } catch { /* fall back to the body */ } }
  return /#([\p{L}\p{M}\p{N}_-]{1,64})\s*$/u.exec(row.body)?.[1].toLowerCase() ?? null;
}

const groupKey = (row: InboxRow) => {
  if (LIKE_KINDS.has(row.kind)) return `likes:${row.target_type ?? ''}:${row.target_id ?? row.route ?? row.id}`;
  const tag = hashtagOf(row);
  return tag ? `hashtag:${tag}` : null;
};

/** One row per liked target (likes + like_summary) and per trending hashtag; rows keep their newest-first order. */
export function groupInbox<T extends InboxRow>(rows: T[]): InboxItem<T>[] {
  const items: InboxItem<T>[] = [], groups = new Map<string, InboxItem<T>>();
  for (const row of rows) {
    const key = groupKey(row);
    if (!key) { items.push({ key: row.id, kind: 'single', lead: row, rows: [row] }); continue; }
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (group.lead.kind === 'like_summary' && row.kind !== 'like_summary') group.lead = row;
      continue;
    }
    const item: InboxItem<T> = { key, kind: key.startsWith('likes:') ? 'likes' : 'hashtag', lead: row, rows: [row] };
    groups.set(key, item); items.push(item);
  }
  return items;
}

/** Distinct people who liked the target, newest first; summary rows only count when no individual like is loaded. */
export function likeActors(item: InboxItem): string[] {
  return [...new Set(item.rows.filter(row => row.kind !== 'like_summary' && row.actor_id).map(row => row.actor_id as string))];
}

export const itemUnread = (item: InboxItem) => item.rows.some(row => row.read_at == null);

/** Splits items into 새 알림 / 지난 알림; an item is new when any of its rows was unread when this visit started. */
export function inboxSections<T extends InboxRow>(items: InboxItem<T>[], fresh: ReadonlySet<string>) {
  const isNew = (item: InboxItem<T>) => item.rows.some(row => fresh.has(row.id));
  return { fresh: items.filter(isNew), earlier: items.filter(item => !isNew(item)) };
}

/** Rows a visit to `tab` marks read automatically (never chat-request kinds). */
export function autoReadIds(rows: InboxRow[], tab: InboxTab, adminAccount = false): string[] {
  return rows.filter(row => row.read_at == null && !BELL_KEEP_UNREAD_KINDS.has(row.kind) && inboxTab(row, adminAccount) === tab).map(row => row.id);
}

/** A refreshed first page replaces the head of the list while older pages loaded by scrolling stay. */
export function mergeHeadPage<T extends InboxRow>(head: T[], previous: T[], pageSize = NOTIFICATION_PAGE_SIZE): T[] {
  if (head.length < pageSize) return head;
  const ids = new Set(head.map(row => row.id)), oldest = head[head.length - 1].created_at;
  return [...head, ...previous.filter(row => !ids.has(row.id) && row.created_at < oldest)];
}

export function appendPage<T extends InboxRow>(rows: T[], page: T[]): T[] {
  const ids = new Set(rows.map(row => row.id));
  return [...rows, ...page.filter(row => !ids.has(row.id))];
}

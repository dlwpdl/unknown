import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_PAGE_SIZE, loadAdminProfilesByIds, logAdminAccess, type AdminPost, type AdminProfile } from '@/lib/admin-data';
import { chillingAvailability } from '@/lib/chilling';
import type { RoomPreview } from '@/lib/types';

export type AdminMeetup = AdminPost & { room_preview: RoomPreview };
export type MeetupFilters = { query: string; cities: string[]; kind: 'all' | 'once' | 'group' };
export type MeetupActivityMode = 'requests' | 'messages';
export type MeetupRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type MeetupActivityRow = { id: string; user_id: string; body: string; created_at: string; status?: MeetupRequestStatus };
export type MeetupPage<T> = { rows: T[]; total: number; profiles: AdminProfile[] };
export const MEETUP_STATES = { open: '모집 중', full: '정원 마감', closed: '모집 종료', ended: '일정 종료', removed: '숨김', deleted: '삭제됨' };
export const REQUEST_STATES: Record<MeetupRequestStatus, string> = { pending: '승인 대기', approved: '승인', rejected: '거절', cancelled: '취소·탈퇴' };

export function adminMeetupState(post: AdminMeetup, now = Date.now()): keyof typeof MEETUP_STATES {
  if (post.deleted_at) return 'deleted';
  if (post.status === 'removed') return 'removed';
  return chillingAvailability(post.room_preview, now);
}

function checkedPage<T>(result: { data: T[] | null; count: number | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data) || result.count == null) throw new Error('ADMIN_MEETUP_DATA_MISSING');
  return { rows: result.data, total: result.count };
}

export async function loadAdminMeetups(client: SupabaseClient, filters: MeetupFilters = { query: '', cities: [], kind: 'all' }, offset = 0): Promise<MeetupPage<AdminMeetup>> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error('INVALID_PAGE');
  await logAdminAccess(client, 'posts');
  let query = client.from('posts').select('*', { count: 'exact' }).not('room_preview', 'is', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + ADMIN_PAGE_SIZE - 1);
  if (filters.query.trim()) query = query.ilike('title', `%${filters.query.trim().slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`);
  if (filters.cities.length) query = query.in('city_id', filters.cities);
  if (filters.kind === 'once') query = query.eq('room_preview->>eventKind', 'once');
  if (filters.kind === 'group') query = query.or('room_preview->>eventKind.eq.group,room_preview->>eventKind.is.null');
  const page = checkedPage<AdminMeetup>(await query);
  return { ...page, profiles: await loadAdminProfilesByIds(client, page.rows.map(row => row.author_id)) };
}

export async function loadAdminMeetupActivity(client: SupabaseClient, postId: string, mode: MeetupActivityMode, status: MeetupRequestStatus | 'all' = 'all', offset = 0): Promise<MeetupPage<MeetupActivityRow>> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error('INVALID_PAGE');
  await logAdminAccess(client, mode === 'requests' ? 'posts' : 'conversations', null, postId);
  let page: { rows: MeetupActivityRow[]; total: number };
  if (mode === 'requests') {
    let query = client.from('meetup_requests').select('*', { count: 'exact' }).eq('post_id', postId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + ADMIN_PAGE_SIZE - 1);
    if (status !== 'all') query = query.eq('status', status);
    const result = checkedPage<{ id: string; requester_id: string; message: string; status: MeetupRequestStatus; created_at: string }>(await query);
    page = { ...result, rows: result.rows.map(row => ({ id: row.id, user_id: row.requester_id, body: row.message, status: row.status, created_at: row.created_at })) };
  } else {
    const rooms = await client.from('conversations').select('id').eq('group_post_id', postId);
    if (rooms.error) throw new Error(rooms.error.message);
    if (!rooms.data) throw new Error('ADMIN_MEETUP_DATA_MISSING');
    if (!rooms.data.length) return { rows: [], total: 0, profiles: [] };
    const result = checkedPage<{ id: string; sender_id: string; body: string; created_at: string }>(await client.from('messages')
      .select('*', { count: 'exact' }).in('conversation_id', rooms.data.map(room => room.id))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + ADMIN_PAGE_SIZE - 1));
    page = { ...result, rows: result.rows.map(row => ({ id: row.id, user_id: row.sender_id, body: row.body, created_at: row.created_at })) };
  }
  return { ...page, profiles: await loadAdminProfilesByIds(client, page.rows.map(row => row.user_id)) };
}

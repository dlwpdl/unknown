import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState, DeviceEventEmitter } from 'react-native';
import { loadUnreadNotificationCount } from '@/lib/community-data';
import { NOTIFICATION_PREFERENCES_CHANGED } from '@/lib/notification-preferences';

type Change = 'INSERT' | 'UPDATE' | 'DELETE' | 'refresh';
type CountContext = { userId: string; cityId?: string | null; scope: 'chat' | 'other' | 'all' };
type Count = { active: boolean; value: number | null; pending: Promise<void> | null; trailing: boolean; listeners: Set<(count: number) => void>; stop: () => void };
type User = { listeners: Set<(change: Change) => void>; counts: Map<string, Count>; stop: () => void };
const clients = new WeakMap<SupabaseClient, Map<string, User>>();
const countKey = ({ cityId, scope }: CountContext) => JSON.stringify([scope === 'chat' ? null : cityId ?? null, scope]);
function userStore(client: SupabaseClient, userId: string) {
  let users = clients.get(client);
  if (!users) { users = new Map(); clients.set(client, users); }
  let user = users.get(userId);
  if (!user) { user = { listeners: new Set(), counts: new Map(), stop() {} }; users.set(userId, user); }
  return { users, user };
}

export function subscribeNotificationChanges(client: SupabaseClient, userId: string, listener: (change: Change) => void) {
  if (!userId) return () => {};
  const { users, user } = userStore(client, userId);
  user.listeners.add(listener);
  if (user.listeners.size === 1) {
    const emit = (change: Change) => { for (const callback of [...user.listeners]) callback(change); };
    let connected = false;
    const channel = client.channel(`notification-updates:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, payload => emit(payload.eventType))
      .subscribe(state => { if (state === 'SUBSCRIBED') { if (connected) emit('refresh'); connected = true; } });
    const preferences = DeviceEventEmitter.addListener(NOTIFICATION_PREFERENCES_CHANGED, () => emit('refresh'));
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') emit('refresh'); });
    user.stop = () => { preferences.remove(); foreground.remove(); void client.removeChannel(channel); };
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false; user.listeners.delete(listener);
    if (!user.listeners.size) { user.stop(); users.delete(userId); }
  };
}

function refresh(client: SupabaseClient, context: CountContext, count: Count) {
  if (!count.active) return;
  if (count.pending) { count.trailing = true; return; }
  const pending = Promise.resolve().then(() => count.active ? loadUnreadNotificationCount(client, context.userId, context.scope) : undefined)
    .then(value => { if (count.active && value !== undefined) { count.value = value; for (const callback of [...count.listeners]) callback(value); } })
    .catch(() => {})
    .finally(() => {
      if (count.pending === pending) count.pending = null;
      if (count.active && count.trailing) { count.trailing = false; refresh(client, context, count); }
    });
  count.pending = pending;
}

export function subscribeUnreadCount(client: SupabaseClient, context: CountContext, listener: (value: number) => void) {
  if (!context.userId) return () => {};
  const { user } = userStore(client, context.userId), key = countKey(context);
  let count = user.counts.get(key);
  if (!count) {
    count = { active: true, value: null, pending: null, trailing: false, listeners: new Set(), stop() {} };
    user.counts.set(key, count);
  }
  const entry = count;
  entry.listeners.add(listener);
  if (entry.listeners.size === 1) {
    entry.stop = subscribeNotificationChanges(client, context.userId, () => refresh(client, context, entry));
    refresh(client, context, entry);
  }
  if (entry.value !== null) listener(entry.value);
  let active = true;
  return () => {
    if (!active) return;
    active = false; entry.listeners.delete(listener);
    if (!entry.listeners.size) { entry.active = false; entry.stop(); user.counts.delete(key); }
  };
}

export function refreshUnreadCount(client: SupabaseClient, context: CountContext) {
  const count = clients.get(client)?.get(context.userId)?.counts.get(countKey(context));
  if (count) refresh(client, context, count);
}

import { Link, useRouter } from 'expo-router';
import { cloneElement, type ReactElement } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';

import { useAuth } from '@/lib/auth';
import { handOffPost } from '@/lib/post-open';
import type { Post } from '@/lib/types';

type Pressing = ReactElement<{ onPress?: (event?: GestureResponderEvent) => void }>;

/**
 * Opens /post/[id] from the pressed card: iOS 18+ grows the post out of the card, Android pushes normally (owner 2026-11-02).
 * The card's own onPress runs first and may call event.preventDefault() to stay. `post` lets the detail draw on its first frame.
 * The child must take an object style: the router's Slot drops function styles and rejects arrays.
 */
export function PostZoomLink({ id, post, children }: { id: string; post?: Post; children: Pressing }) {
  const router = useRouter();
  const { isAuthed, me } = useAuth();
  const href = { pathname: '/post/[id]', params: { id } } as const;
  const handOff = (event?: { defaultPrevented?: boolean }) => { if (post && isAuthed && !event?.defaultPrevented) handOffPost(me.id, post); };
  if (Platform.OS !== 'web') return <Link href={href} push asChild onPress={handOff}><Link.AppleZoom>{children}</Link.AppleZoom></Link>;
  // shortcut: web keeps a plain push, because an anchor-wrapped Pressable is untested there; switch to Link once web is checked.
  return cloneElement(children, { onPress: event => {
    children.props.onPress?.(event);
    if (event?.defaultPrevented) return;
    handOff(event); router.push(href);
  } });
}

import { Link, useRouter, type Href } from 'expo-router';
import { cloneElement, useSyncExternalStore, type ReactElement } from 'react';
import { AccessibilityInfo, Platform, type GestureResponderEvent } from 'react-native';

import { useAuth } from '@/lib/auth';
import { handOffPost } from '@/lib/post-open';
import type { Post } from '@/lib/types';

type Pressing = ReactElement<{ onPress?: (event?: GestureResponderEvent) => void }>;

// expo-router lays the zoom source out as a 0x0 display:contents box, and the simulator's accessibility tree then lists none
// of the cards inside it, so screen-reader users get the plain push instead of the zoom.
// shortcut: Voice Control and Switch Control are not detected; drop this once a device shows VoiceOver reaching zoomed cards.
let screenReaderOn = false;
const screenReaderListeners = new Set<() => void>();
const setScreenReader = (on: boolean) => { screenReaderOn = on; screenReaderListeners.forEach(listener => listener()); };
if (Platform.OS !== 'web') {
  void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader, () => {});
  AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
}
const subscribeScreenReader = (listener: () => void) => { screenReaderListeners.add(listener); return () => { screenReaderListeners.delete(listener); }; };

/**
 * Opens `href` from the pressed card: iOS 18+ grows the screen out of the card, Android pushes normally (owner 2026-11-02).
 * The card's own onPress runs first and may call event.preventDefault() to stay; `onOpen` runs right before the screen opens.
 * The child must take an object style: the router's Slot drops function styles and rejects arrays.
 * Its root must stay one native view (a Pressable, or a View with collapsable={false}): the zoom source mounts only its first native child.
 */
// anchor: keep the web <a> (open in new tab) where the card already had one, like event cards.
export function ZoomLink({ href, onOpen, children, anchor = false }: { href: Href; onOpen?: (event?: { defaultPrevented?: boolean }) => void; children: Pressing; anchor?: boolean }) {
  const router = useRouter();
  const screenReader = useSyncExternalStore(subscribeScreenReader, () => screenReaderOn);
  if (Platform.OS !== 'web' && !screenReader) return <Link href={href} push asChild onPress={onOpen}><Link.AppleZoom>{children}</Link.AppleZoom></Link>;
  if (Platform.OS === 'web' && anchor) return <Link href={href} asChild onPress={onOpen}>{children}</Link>;
  // shortcut: web keeps a plain push, because an anchor-wrapped Pressable is untested there; switch to Link once web is checked.
  // Screen readers on iOS/Android land here too (see above).
  return cloneElement(children, { onPress: event => {
    children.props.onPress?.(event);
    if (event?.defaultPrevented) return;
    onOpen?.(event); router.push(href);
  } });
}

/** Opens /post/[id] through ZoomLink. `post` lets the detail draw on its first frame. */
export function PostZoomLink({ id, post, children }: { id: string; post?: Post; children: Pressing }) {
  const { isAuthed, me } = useAuth();
  const handOff = (event?: { defaultPrevented?: boolean }) => { if (post && isAuthed && !event?.defaultPrevented) handOffPost(me.id, post); };
  return <ZoomLink href={{ pathname: '/post/[id]', params: { id } }} onOpen={handOff}>{children}</ZoomLink>;
}

import { Image } from 'expo-image';
import { StyleSheet, type ImageStyle } from 'react-native';
import { useMemo, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';

import { ClayPhoto } from '@/components/clay';
import { ControlMotion } from '@/constants/design-system';
import { createChatMemberPhotoQueue } from '@/lib/chat-details';
import { loadMeetupProfilePhoto } from '@/lib/chilling-profile-media';
import { supabase } from '@/lib/supabase';

const photos = createChatMemberPhotoQueue(path => loadMeetupProfilePhoto(supabase, path));

export function ChatMemberAvatar({ viewerId, roomId, path, active = true, style, accessibilityLabel, fallback }: {
  viewerId: string; roomId: string; path?: string | null; active?: boolean;
  style: ComponentProps<typeof Image>['style']; accessibilityLabel?: string; fallback: ReactNode;
}) {
  const photo = useMemo(() => {
    const scope = JSON.stringify([viewerId, roomId]);
    return {
      read: () => active && path ? photos.read(scope, path) : undefined,
      subscribe(changed: () => void) {
        if (!active || !path || !viewerId) return () => {};
        return photos.subscribe(scope, path, changed).cancel;
      },
    };
  }, [viewerId, roomId, path, active]);
  const uri = useSyncExternalStore(photo.subscribe, photo.read, () => undefined);
  const size = StyleSheet.flatten(style as ImageStyle)?.width;
  if (uri && typeof size === 'number') return <ClayPhoto uri={uri} size={size} cachePolicy="none" transition={ControlMotion.settleMs} recyclingKey={JSON.stringify([viewerId, roomId, path])} accessibilityLabel={accessibilityLabel} />;
  return uri ? <Image source={{ uri }} cachePolicy="none" transition={ControlMotion.settleMs} recyclingKey={JSON.stringify([viewerId, roomId, path])}
    style={style} contentFit="cover" accessibilityLabel={accessibilityLabel} accessibilityIgnoresInvertColors /> : fallback;
}

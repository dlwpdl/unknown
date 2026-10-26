import { Image } from 'expo-image';
import { useMemo, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';

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
  return uri ? <Image source={{ uri }} cachePolicy="none" recyclingKey={JSON.stringify([viewerId, roomId, path])}
    style={style} contentFit="cover" accessibilityLabel={accessibilityLabel} accessibilityIgnoresInvertColors /> : fallback;
}

import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Pressable, View, StyleSheet, useColorScheme } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadDailyQuota, POST_QUOTA_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { INITIAL_QUOTA } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { DailyQuota } from '@/lib/types';

export default function AppTabs() {
  return (
    <Tabs>
      <AnimatedTabSlot />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>{t.tabs.today}</TabButton>
          </TabTrigger>
          <TabTrigger name="chat" href="/chat" asChild>
            <TabButton>{t.tabs.chat}</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton>{t.tabs.profile}</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function AnimatedTabSlot() {
  const pathname = usePathname();
  const contentRef = useRef<View>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const animation = (contentRef.current as unknown as HTMLElement)?.animate?.(
      [
        { opacity: 0.88, transform: 'translateY(4px) scale(0.995)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 250, easing: 'cubic-bezier(0, 0, 0.2, 1)' }
    );
    return () => animation?.cancel();
  }, [pathname]);

  return (
    <View ref={contentRef} nativeID="gling-tab-content" style={styles.tabContent}>
      <TabSlot style={{ height: '100%' }} />
    </View>
  );
}

export function TabButton({ children, isFocused, onPress, ...props }: TabTriggerSlotProps) {
  const { play } = useInteractionFeedback();
  return (
    <Pressable
      {...props}
      onPress={(event) => {
        play('selection');
        onPress?.(event);
      }}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const dark = useColorScheme() === 'dark';
  const router = useRouter();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  const [quota, setQuota] = useState<DailyQuota>(INITIAL_QUOTA);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void loadDailyQuota(supabase).then((next) => active && setQuota(next)).catch(() => {});
    const subscription = DeviceEventEmitter.addListener(POST_QUOTA_CHANGED_EVENT, setQuota);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [isAuthed, me.id]);

  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <Pressable
          onPress={() => {
            play('selection');
            router.push({ pathname: '/', params: { compose: '1' } });
          }}
          accessibilityRole="button"
          accessibilityLabel={`${t.feed.write} ${t.feed.remaining(quota.used, quota.max)}`}
          style={({ pressed }) => [styles.writeEntry, pressed && styles.pressed]}>
          <Image
            source={require('@/assets/brand/gling-wordmark.png')}
            style={styles.brandLogo}
            contentFit="contain"
            tintColor={dark ? Colors.dark.text : undefined}
          />
          <View style={[styles.quotaBadge, { backgroundColor: quota.used < quota.max ? Colors.light.accent : Colors.light.textSecondary }]}>
            <ThemedText type="smallBold" style={styles.quotaText}>{t.feed.remaining(quota.used, quota.max)}</ThemedText>
          </View>
        </Pressable>

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabContent: {
    flex: 1,
  },
  tabListContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  writeEntry: { position: 'relative', width: 112, minHeight: 36, marginRight: 'auto', justifyContent: 'center' },
  brandLogo: { width: 72, height: 32 },
  quotaBadge: { position: 'absolute', top: -2, right: 0, minWidth: 30, height: 18, borderRadius: 999, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  quotaText: { color: Colors.light.accentInk, fontSize: 10, lineHeight: 13, fontVariant: ['tabular-nums'] },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});

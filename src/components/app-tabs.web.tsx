import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n/ko';
import { useTheme } from '@/hooks/use-theme';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export default function AppTabs() {
  const pathname = usePathname();
  const unreadCount = useUnreadCount();
  return (
    <Tabs>
      <AnimatedTabSlot />
      <TabList asChild style={pathname === '/' ? { display: 'none' } : undefined}>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon="today">{t.tabs.today}</TabButton>
          </TabTrigger>
          <TabTrigger name="meetups" href="/meetups" asChild>
            <TabButton icon="groups">{t.tabs.meetups}</TabButton>
          </TabTrigger>
          <TabTrigger name="compose" href="/compose" asChild>
            <TabButton icon="edit_square">{t.tabs.write}</TabButton>
          </TabTrigger>
          <TabTrigger name="chat" href="/chat" asChild>
            <TabButton icon="forum">{t.tabs.chat}</TabButton>
          </TabTrigger>
          <TabTrigger name="notifications" href="/notifications" asChild>
            <TabButton icon="notifications" badge={unreadCount}>{t.tabs.notifications}</TabButton>
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

export function TabButton({ children, icon, badge = 0, isFocused, onPress, ...props }: TabTriggerSlotProps & { icon: 'today' | 'groups' | 'edit_square' | 'forum' | 'notifications'; badge?: number }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return (
    <Pressable
      {...props}
      onPress={(event) => {
        play('selection');
        onPress?.(event);
      }}
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <View style={styles.tabButtonView}>
        <SymbolView name={{ web: icon }} size={22} tintColor={isFocused ? theme.accent : theme.textSecondary} />
        {badge > 0 && <View style={[styles.badge, { backgroundColor: theme.accent }]}><ThemedText style={{ color: theme.accentInk, fontSize: 10, lineHeight: 14 }}>{badge > 99 ? '99+' : badge}</ThemedText></View>}
        <ThemedText type="small" style={{ fontSize: 11, color: isFocused ? theme.accent : theme.textSecondary }}>
          {children}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const theme = useTheme();
  return (
    <View {...props} style={[styles.tabListContainer, { backgroundColor: theme.background, borderTopColor: theme.line }, props.style]}>
      <ThemedView style={styles.innerContainer}>{props.children}</ThemedView>
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
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  tabButton: { flex: 1, minWidth: 44, minHeight: 48 },
  badge: { position: 'absolute', right: 4, top: 0, borderRadius: 8, minWidth: 14, paddingHorizontal: 3, alignItems: 'center' },
  pressed: {
    opacity: 0.72,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});

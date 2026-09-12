import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ADMIN_SECTIONS, adminOptionKeys, type AdminSection } from '@/lib/admin';
import type { AdminCounts } from '@/lib/admin-data';
import './admin.css';

const sectionIcons = {
  analytics: { ios: 'chart.bar', web: 'bar_chart' },
  overview: { ios: 'square.grid.2x2', web: 'dashboard' },
  safety: { ios: 'shield', web: 'shield' },
  reports: { ios: 'flag', web: 'flag' },
  users: { ios: 'person.2', web: 'group' },
  posts: { ios: 'doc.text', web: 'article' },
  conversations: { ios: 'bubble.left.and.bubble.right', web: 'forum' },
} as const;

export function AdminShell({
  activeSection,
  counts,
  busy,
  onSection,
  onRefresh,
  onSignOut,
  children,
}: {
  activeSection: AdminSection;
  counts: AdminCounts;
  busy: boolean;
  onSection: (section: AdminSection) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const compact = useWindowDimensions().width < 860;

  return (
    <View nativeID="gling-admin-console" style={[styles.page, compact && styles.pageCompact]}>
      <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
        <View style={styles.brandRow}>
          <Image
            source={require('@/assets/brand/gling-lockup.png')}
            style={styles.brandLogo}
            contentFit="contain"
            accessibilityLabel="gling"
          />
          <View>
            <ThemedText type="small" style={styles.muted}>운영 콘솔</ThemedText>
          </View>
        </View>

        {!compact && <ThemedText type="small" style={styles.navLabel}>워크스페이스</ThemedText>}
        <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="관리자 메뉴" contentContainerStyle={styles.nav}>
          {ADMIN_SECTIONS.map((item) => {
            const active = item.id === activeSection;
            const badge = item.id === 'reports' && counts.openReports > 0
              ? counts.openReports
              : item.id === 'safety' && counts.safetyHigh > 0 ? counts.safetyHigh : null;
            return (
              <Pressable
                key={item.id}
                onPress={() => onSection(item.id)}
                accessibilityRole="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
                style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && styles.pressed]}>
                <View aria-hidden accessibilityElementsHidden><SymbolView name={sectionIcons[item.id]} size={19} tintColor={active ? Colors.light.accent : Colors.light.textSecondary} /></View>
                <ThemedText type="smallBold" style={active ? styles.navTextActive : styles.navText}>
                  {item.label}
                </ThemedText>
                {badge != null && (
                  <View style={styles.badge}>
                    <ThemedText type="smallBold" style={styles.badgeText}>{badge}</ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {!compact && (
          <View style={styles.sidebarFooter}>
            <View style={styles.auditNotice}>
              <ThemedText type="smallBold">운영자 전용</ThemedText>
              <ThemedText type="small" style={styles.muted}>모든 열람은 감사 로그에 기록됩니다.</ThemedText>
            </View>
            <Pressable onPress={onRefresh} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.utilityButton, busy && styles.disabled, pressed && styles.pressed]}>
              <ThemedText type="smallBold">{busy ? '새로고침 중' : '새로고침'}</ThemedText>
            </Pressable>
            <Pressable onPress={onSignOut} accessibilityRole="button" style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
              <ThemedText type="small" style={styles.muted}>로그아웃</ThemedText>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, compact && styles.contentCompact]}>
        {compact && (
          <View style={styles.compactActions}>
            <Pressable onPress={onRefresh} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.compactButton, busy && styles.disabled, pressed && styles.pressed]}>
              <ThemedText type="smallBold">{busy ? '새로고침 중' : '새로고침'}</ThemedText>
            </Pressable>
            <Pressable onPress={onSignOut} accessibilityRole="button" style={({ pressed }) => [styles.compactButton, pressed && styles.pressed]}>
              <ThemedText type="small" style={styles.muted}>로그아웃</ThemedText>
            </Pressable>
          </View>
        )}
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%', flexDirection: 'row', backgroundColor: Colors.light.background },
  pageCompact: { flexDirection: 'column' },
  sidebar: { width: 232, padding: Spacing.three, borderRightWidth: 1, borderRightColor: Colors.light.line, backgroundColor: Colors.light.backgroundElement },
  sidebarCompact: { width: '100%', paddingVertical: Spacing.three, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, marginBottom: Spacing.three },
  brandLogo: { width: 116, height: 39 },
  muted: { color: Colors.light.textSecondary },
  nav: { gap: Spacing.one },
  navLabel: { color: Colors.light.textSecondary, fontSize: 11, paddingHorizontal: Spacing.three, marginBottom: Spacing.two },
  navItem: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  navItemActive: { backgroundColor: Colors.light.card },
  navText: { color: Colors.light.textSecondary },
  navTextActive: { color: Colors.light.accent },
  badge: { marginLeft: 'auto', minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, backgroundColor: Colors.light.accent, alignItems: 'center' },
  badgeText: { color: Colors.light.accentInk, fontSize: 11 },
  sidebarFooter: { marginTop: 'auto', gap: Spacing.two },
  auditNotice: { gap: Spacing.one, padding: Spacing.two },
  utilityButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.65 },
  signOutButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  content: { flex: 1, minWidth: 0 },
  contentInner: { width: '100%', maxWidth: 1280, alignSelf: 'center', padding: Spacing.five, paddingBottom: Spacing.six },
  contentCompact: { padding: Spacing.three, paddingBottom: Spacing.six },
  compactActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginBottom: Spacing.three },
  compactButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two, borderRadius: 8 },
});

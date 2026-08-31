import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/admin';
import type { AdminCounts } from '@/lib/admin-data';

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
    <View style={[styles.page, compact && styles.pageCompact]}>
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
                accessibilityState={{ selected: active }}
                style={[styles.navItem, active && styles.navItemActive]}>
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
            <Pressable onPress={onRefresh} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={[styles.utilityButton, busy && styles.disabled]}>
              <ThemedText type="smallBold">{busy ? '새로고침 중' : '새로고침'}</ThemedText>
            </Pressable>
            <Pressable onPress={onSignOut} accessibilityRole="button" style={styles.signOutButton}>
              <ThemedText type="small" style={styles.muted}>로그아웃</ThemedText>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {compact && (
          <View style={styles.compactActions}>
            <Pressable onPress={onRefresh} disabled={busy} accessibilityRole="button">
              <ThemedText type="smallBold">{busy ? '새로고침 중' : '새로고침'}</ThemedText>
            </Pressable>
            <Pressable onPress={onSignOut} accessibilityRole="button">
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
  sidebar: { width: 232, padding: Spacing.four, borderRightWidth: 1, borderRightColor: Colors.light.line, backgroundColor: Colors.light.card },
  sidebarCompact: { width: '100%', paddingVertical: Spacing.three, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.four },
  brandLogo: { width: 116, height: 39 },
  muted: { color: Colors.light.textSecondary },
  nav: { gap: Spacing.one },
  navItem: { minHeight: 42, paddingHorizontal: Spacing.three, borderLeftWidth: 3, borderLeftColor: 'transparent', borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  navItemActive: { borderLeftColor: Colors.light.accent, backgroundColor: '#F9ECE9' },
  navText: { color: Colors.light.textSecondary },
  navTextActive: { color: Colors.light.text },
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11, backgroundColor: Colors.light.accent, alignItems: 'center' },
  badgeText: { color: Colors.light.accentInk, fontSize: 11 },
  sidebarFooter: { marginTop: 'auto', gap: Spacing.two },
  auditNotice: { gap: Spacing.one, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.background },
  utilityButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  disabled: { opacity: 0.55 },
  signOutButton: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  contentInner: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: Spacing.four, paddingBottom: Spacing.six },
  compactActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.four, marginBottom: Spacing.three },
});

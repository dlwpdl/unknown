import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ADMIN_NAV_GROUPS, ADMIN_SECTIONS, adminOptionKeys, type AdminSection } from '@/lib/admin';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import type { AdminCounts } from '@/lib/admin-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import './admin.css';

const sectionIcons = {
  analytics: { ios: 'chart.bar', web: 'bar_chart' },
  ticketmaster: { ios: 'ticket', web: 'confirmation_number' },
  merchants: { ios: 'building.2', web: 'store' },
  overview: { ios: 'square.grid.2x2', web: 'dashboard' },
  safety: { ios: 'shield', web: 'shield' },
  alerts: { ios: 'exclamationmark.bubble', web: 'report' },
  trending: { ios: 'flame', web: 'local_fire_department' },
  errors: { ios: 'ladybug', web: 'bug_report' },
  reports: { ios: 'flag', web: 'flag' },
  users: { ios: 'person.2', web: 'group' },
  posts: { ios: 'doc.text', web: 'article' },
  conversations: { ios: 'bubble.left.and.bubble.right', web: 'forum' },
} as const;

export function AdminShell({
  activeSection,
  counts,
  busy,
  lastUpdated,
  onSearch,
  onSection,
  onRefresh,
  onSignOut,
  children,
}: {
  activeSection: AdminSection;
  counts: AdminCounts;
  busy: boolean;
  lastUpdated?: string | null;
  onSearch?: () => void;
  onSection: (section: AdminSection) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const { play } = useInteractionFeedback();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeItem = ADMIN_SECTIONS.find((entry) => entry.id === activeSection) ?? { id: activeSection, label: '운영 콘솔' };
  const activeGroup = ADMIN_NAV_GROUPS.find((group) => group.sections.includes(activeSection));

  const navItem = (item: { id: AdminSection; label: string }) => {
    const active = item.id === activeSection;
    const badge = item.id === 'reports'
      ? counts.openReports
      : item.id === 'safety' ? counts.safetyHigh
      : item.id === 'alerts' ? counts.alertsOpen : null;
    return (
      <Pressable
        key={item.id}
        onPress={() => { play('selection'); onSection(item.id); setMenuOpen(false); }}
        accessibilityRole="tab"
        accessibilityLabel={badge != null ? `${item.label} ${badge}건` : item.label}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
        style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && styles.pressed]}>
        <View aria-hidden accessibilityElementsHidden><SymbolView name={sectionIcons[item.id]} size={19} tintColor={active ? Colors.admin.accent : Colors.admin.textSecondary} /></View>
        <ThemedText type="smallBold" style={active ? styles.navTextActive : styles.navText}>
          {item.label}
        </ThemedText>
        {badge != null && (
          <View style={[styles.badge, badge === 0 && styles.badgeQuiet]}>
            <ThemedText type="smallBold" style={styles.badgeText}>{badge}</ThemedText>
          </View>
        )}
      </Pressable>
    );
  };

  const navGroups = () => ADMIN_NAV_GROUPS.map((group) => (
    <View key={group.label} style={styles.navGroup}>
      <ThemedText type="small" style={styles.navLabel}>{group.label}</ThemedText>
      {group.sections
        .map((sectionId) => ADMIN_SECTIONS.find((entry) => entry.id === sectionId))
        .filter((entry): entry is { id: AdminSection; label: string } => !!entry)
        .map(navItem)}
    </View>
  ));

  return (
    <ThemeOverrideProvider scheme="admin">
    <View nativeID="gling-admin-console" style={[styles.page, compact && styles.pageCompact]}>
      <View nativeID="admin-sidebar" style={[styles.sidebar, compact && styles.sidebarCompact]}>
        <View style={[styles.brandRow, compact && styles.brandRowCompact]}>
          <Image
            source={require('@/assets/brand/gling-night-wordmark-light.png')}
            style={[styles.brandLogo, compact && styles.brandLogoCompact]}
            contentFit="contain"
            accessibilityLabel="gling"
          />
          {!compact && <View>
            <ThemedText type="small" style={styles.workspaceLabel}>관리자</ThemedText>
          </View>}
        </View>

        {compact ? (
          <>
            <Pressable
              onPress={() => { play('selection'); setMenuOpen((value) => !value); }}
              accessibilityRole="button"
              accessibilityState={{ expanded: menuOpen }}
              accessibilityLabel={`현재 섹션 ${activeItem.label}, 섹션 목록 ${menuOpen ? '닫기' : '열기'}`}
              style={({ pressed }) => [styles.picker, styles.pickerCompact, menuOpen && styles.pickerOpen, pressed && styles.pressed]}>
              <View aria-hidden accessibilityElementsHidden><SymbolView name={sectionIcons[activeSection]} size={18} tintColor={Colors.admin.accent} /></View>
              <ThemedText type="smallBold">{activeItem.label}</ThemedText>
              <ThemedText type="small" style={styles.muted}>{menuOpen ? '닫기 ▴' : '섹션 ▾'}</ThemedText>
            </Pressable>
            {menuOpen && (
              <ScrollView accessibilityRole="tablist" accessibilityLabel="관리자 메뉴" style={styles.pickerMenu} contentContainerStyle={styles.nav}>{navGroups()}</ScrollView>
            )}
          </>
        ) : (
          <>
            <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="관리자 메뉴" contentContainerStyle={styles.nav}>
              {navGroups()}
            </ScrollView>
          </>
        )}

        {!compact && (
          <View style={styles.sidebarFooter}>
            <View style={styles.auditNotice}>
              <View aria-hidden accessibilityElementsHidden><SymbolView name={{ ios: 'lock.shield', web: 'shield' }} size={17} tintColor={Colors.admin.textSecondary} /></View>
              <View style={{ flex: 1 }}><ThemedText type="smallBold">운영자 전용</ThemedText>
              <ThemedText type="small" style={styles.muted}>열람·처리 기록 저장</ThemedText></View>
            </View>
            <Pressable onPress={() => { play('selection'); onSignOut(); }} accessibilityRole="button" style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
              <ThemedText type="small" style={styles.muted}>로그아웃</ThemedText>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.main}>
        <View nativeID="admin-topbar" style={[styles.topbar, compact && styles.topbarCompact]}>
          <View style={styles.breadcrumb}>
            <ThemedText type="small" style={styles.muted}>{activeGroup?.label}</ThemedText>
            {!compact && <><ThemedText type="small" style={styles.muted}>/</ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>{activeItem.label}</ThemedText></>}
          </View>
          <View style={styles.topbarActions}>
            {!compact && lastUpdated && <ThemedText type="small" style={styles.muted}>갱신 {lastUpdated}</ThemedText>}
            {!!onSearch && <Pressable onPress={() => { play('selection'); onSearch(); }} accessibilityRole="button" accessibilityLabel="화면·회원 검색 열기" style={({ pressed }) => [styles.topbarButton, !compact && styles.searchButton, pressed && styles.pressed]}>
              <View aria-hidden accessibilityElementsHidden><SymbolView name={{ ios: 'magnifyingglass', web: 'search' }} size={18} tintColor={Colors.admin.textSecondary} /></View>
              {!compact && <><ThemedText type="small" style={styles.muted}>화면·회원 검색</ThemedText><ThemedText type="small" style={styles.keycap}>⌘K</ThemedText></>}
            </Pressable>}
            <Pressable onPress={() => { play('selection'); onRefresh(); }} disabled={busy} accessibilityRole="button" accessibilityLabel={busy ? '새로고침 중' : '새로고침'} accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.topbarButton, busy && styles.disabled, pressed && styles.pressed]}>
              <View aria-hidden accessibilityElementsHidden><SymbolView name={{ ios: 'arrow.clockwise', web: 'refresh' }} size={18} tintColor={Colors.admin.textSecondary} /></View>
            </Pressable>
            {compact && <Pressable onPress={() => { play('selection'); onSignOut(); }} accessibilityRole="button" accessibilityLabel="로그아웃" style={({ pressed }) => [styles.topbarButton, pressed && styles.pressed]}><View aria-hidden accessibilityElementsHidden><SymbolView name={{ ios: 'rectangle.portrait.and.arrow.right', web: 'logout' }} size={18} tintColor={Colors.admin.textSecondary} /></View></Pressable>}
          </View>
        </View>
        <ScrollView nativeID="admin-main-scroll" style={styles.content} contentContainerStyle={[styles.contentInner, compact && styles.contentCompact]}>
          {children}
        </ScrollView>
      </View>
    </View>
    </ThemeOverrideProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0, flexDirection: 'row', backgroundColor: Colors.admin.background },
  pageCompact: { flexDirection: 'column' },
  sidebar: { width: 224, flexShrink: 0, padding: 12, borderRightWidth: 1, borderRightColor: Colors.admin.line, backgroundColor: Colors.admin.card },
  sidebarCompact: { width: '100%', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12 },
  brandLogo: { width: 88, height: 30 },
  brandRowCompact: { marginBottom: 0, paddingHorizontal: 0, paddingVertical: 0 },
  brandLogoCompact: { width: 74, height: 26 },
  workspaceLabel: { color: Colors.admin.textSecondary, fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 5 },
  muted: { color: Colors.admin.textSecondary },
  navScroll: { flex: 1, minHeight: 0 },
  nav: { gap: 20, paddingBottom: Spacing.three },
  navGroup: { gap: Spacing.one },
  picker: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 8, borderWidth: 1, borderColor: Colors.admin.line, backgroundColor: Colors.admin.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pickerCompact: { flex: 1, minWidth: 0 },
  pickerOpen: { borderColor: Colors.admin.accent },
  pickerMenu: { flexBasis: '100%', maxHeight: 300, marginTop: Spacing.two },
  navLabel: { color: Colors.admin.textSecondary, fontSize: 11, paddingHorizontal: 12, marginBottom: Spacing.one },
  navItem: { minHeight: 44, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  navItemActive: { backgroundColor: Colors.admin.backgroundSelected },
  navText: { color: Colors.admin.textSecondary },
  navTextActive: { color: Colors.admin.accent },
  badge: { marginLeft: 'auto', minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: Colors.admin.backgroundSelected, alignItems: 'center' },
  badgeQuiet: { backgroundColor: Colors.admin.backgroundElement },
  badgeText: { color: Colors.admin.accent, fontSize: 11 },
  sidebarFooter: { marginTop: Spacing.two, borderTopWidth: 1, borderTopColor: Colors.admin.line, paddingTop: 12 },
  auditNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: Spacing.two },
  disabled: { opacity: 0.55 },
  pressed: { backgroundColor: Colors.admin.backgroundElement, opacity: 0.8 },
  signOutButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  content: { flex: 1, minWidth: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  topbar: { minHeight: 68, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingHorizontal: Spacing.four, borderBottomWidth: 1, borderBottomColor: Colors.admin.line, backgroundColor: Colors.admin.card },
  topbarCompact: { minHeight: 56, paddingHorizontal: Spacing.three, gap: Spacing.two },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minWidth: 0, flexShrink: 1 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  topbarButton: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderRadius: 8 },
  searchButton: { paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.admin.line, minWidth: 208, justifyContent: 'flex-start' },
  keycap: { marginLeft: 'auto', paddingHorizontal: 5, borderRadius: 4, backgroundColor: Colors.admin.backgroundElement, fontSize: 11 },
  contentInner: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: Spacing.five, paddingBottom: Spacing.six },
  contentCompact: { padding: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.six },
});

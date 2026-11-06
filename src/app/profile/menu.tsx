import { useLanguage } from '@/hooks/use-language';
import { MerchantAccountEntry } from '@/components/merchant-account-connections';
import { LinkedAccountEntry } from '@/components/linked-account-entry';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { SymbolView } from '@/components/symbol-view';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-provider';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';

// P4: everything that used to sit on the own profile — settings, the four manage cells and the account menu — opens from ···.
export default function ProfileMenuScreen() {
  const { tr, t } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const { trustLevel, signOut } = useAuth(), { membership } = useMembership();
  const unread = useUnreadCount('other');
  const membershipLabel = membership ? tr(({ free: '베이직', plus: '플러스', pro: '프로', premium: '프리미엄', admin: '관리자' } as const)[membership.tier]) : null;
  const unreadLabel = unread > 0 ? tr('새 소식 {0}', unread) : tr('새 소식 없음');
  const row = (id: string, symbol: ComponentProps<typeof SymbolView>['name'], title: string, sub: string, path: Parameters<typeof router.push>[0]) =>
    <Pressable key={id} analyticsId={id} accessibilityRole="button" accessibilityLabel={title}
      onPress={() => { play('selection'); router.push(path); }}
      style={({ pressed }) => [styles.accountRow, { backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
      <View style={[styles.accountIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={symbol} size={22} tintColor={theme.navy} /></View>
      <View style={styles.accountText}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText></View>
      <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
    </Pressable>;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView analyticsId="profile.menu.scroll" contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
          <View style={[styles.manage, { backgroundColor: theme.backgroundElement }]}>
            {([
              ['profile.menu.membership', tr("멤버십"), membershipLabel, { ios: 'star.circle', android: 'stars', web: 'stars' }, false, () => router.push('/profile/membership')],
              ['profile.menu.trust', tr("인증 Lv{0}", (trustLevel)), trustLevel === 1 ? t.trust.short(trustLevel) : tr("등록된 단계"), { ios: 'checkmark.seal', android: 'verified', web: 'verified' }, false, () => router.push('/profile/trust')],
              ['profile.menu.notifications', t.notifications.title, unreadLabel, { ios: 'bell', android: 'notifications', web: 'notifications' }, unread > 0, () => router.navigate('/notifications')],
              ['profile.menu.saved', t.profile.saved, tr("모아보기"), { ios: 'bookmark', android: 'bookmark', web: 'bookmark' }, false, () => router.push('/profile/saved')],
            ] as const).map(([id, label, sub, symbol, attention, onPress]) => (
              <Pressable analyticsId={id} key={id} onPress={() => { play('selection'); onPress(); }} accessibilityRole="button" accessibilityLabel={`${label}, ${sub ?? ''}`}
                style={({ pressed }) => [styles.manageCell, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
                <View style={styles.manageIcon}>
                  <SymbolView name={symbol} size={22} weight="medium" tintColor={attention ? theme.accent : theme.navy} />
                  {attention && <View style={[styles.manageDot, { backgroundColor: theme.accent, borderColor: theme.backgroundElement }]} />}
                </View>
                <ThemedText type="smallBold" style={styles.manageLabel}>{label}</ThemedText>
                <ThemedText type="small" themeColor={attention ? undefined : 'textSecondary'} style={[styles.manageSub, attention && { color: theme.accent }]}>{sub}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={[styles.accountMenu, { backgroundColor: theme.card, borderColor: theme.line }]}>
            {row('profile.menu.settings', { ios: 'gearshape', android: 'settings', web: 'settings' }, t.profile.settings, tr('닉네임 · 활동 지역 · 화면 모드'), '/profile/settings')}
            {row('profile.meetup-profile', { ios: 'person.crop.rectangle', android: 'badge', web: 'badge' }, tr('모임 프로필 관리'), tr('모임 사진·소개·공개 범위를 따로 설정해요'), '/meetup-profile')}
            {row('profile.meetup-reviews', { ios: 'person.2', android: 'group', web: 'group' }, tr('모임 후기 · 매너 평가'), tr('내 후기와 매너 평가 관리'), '/profile/meetup-reviews')}
            {row('profile.invite', { ios: 'gift', android: 'redeem', web: 'redeem' }, tr('친구 초대'), tr('친구가 첫 모임에 오면 플러스 2주 이용권'), '/profile/invite')}
            <MerchantAccountEntry />
            <LinkedAccountEntry />
          </View>
          <View style={[styles.menu, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            {PROMOTIONS_PREVIEW_ENABLED && <><Pressable analyticsId="profile.menu.promotions" style={styles.menuRow} accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/promotions'); }}>
              <ThemedText type="small">{tr("홍보 크레딧")}</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} /></>}
            <Pressable analyticsId="profile.menu.guidelines" style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/guidelines'); }}>
              <ThemedText type="small">{t.profile.guidelines}</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable analyticsId="profile.menu.sign-out" style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              onPress={() => { play('selection'); Alert.alert(t.profile.signOutTitle, t.profile.signOutBody, [
                { text: t.profile.cancel, style: 'cancel', onPress: () => play('selection') },
                { text: t.profile.signOut, style: 'destructive', onPress: () => { play('warning'); void signOut(); if (router.canGoBack()) router.back(); else router.replace('/profile'); } },
              ]); }}>
              <ThemedText type="small" themeColor="textSecondary">{t.profile.signOut}</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  menu: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  manage: { flexDirection: 'row', borderRadius: 16, padding: Spacing.one },
  manageCell: { flex: 1, minWidth: 0, minHeight: 88, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: Spacing.one },
  manageIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  manageDot: { position: 'absolute', top: 1, right: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  manageLabel: { textAlign: 'center' },
  manageSub: { textAlign: 'center', fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  accountMenu: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  accountRow: { minHeight: 72, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, gap: Spacing.one },
  menuRow: { paddingHorizontal: Spacing.three, paddingVertical: 14, minHeight: 44, justifyContent: 'center' },
  divider: { height: 1, marginHorizontal: Spacing.three },
});

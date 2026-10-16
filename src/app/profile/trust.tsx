import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const levels = [
  { level: 1, title: '계정 확인', summary: 'Apple · 카카오 · Google 로그인', detail: '소셜 계정으로 글링에 로그인하면 적용돼요. 소셜 로그인만으로 실명이나 나이가 확인되지는 않아요.' },
  { level: 2, title: '전화번호 확인', summary: '본인 명의 번호 확인', detail: '예정 기준: 인증 서비스에서 본인 명의 전화번호 확인이 완료되면 부여해요. 번호를 입력하거나 문자만 받는 것으로는 올라가지 않아요. 닉네임 옆에는 빨간 체크가 표시돼요.' },
  { level: 3, title: '신분증 · 얼굴 대조', summary: '신분증과 본인 촬영 비교', detail: '예정 기준: 신분증과 본인 촬영을 대조해 일치 여부를 확인한 뒤 부여해요. 닉네임 옆에는 글링 마크가 표시돼요.' },
] as const;

export default function TrustScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<number | null>(1);
  const current = levels[auth.trustLevel - 1] ?? levels[0];

  if (!auth.isAuthed) return <LoginPanel reason="내 인증 단계를 확인하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.eyebrow}>내 계정의 인증 상태</ThemedText>
      <View style={[styles.hero, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={styles.heroHead}>
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">현재 단계</ThemedText>
            <ThemedText accessibilityRole="header" style={styles.heroTitle}>Lv{auth.trustLevel} · {current.title}</ThemedText>
          </View>
          <View style={[styles.heroIcon, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView name={{ ios: 'checkmark.seal', android: 'verified', web: 'verified' }} size={28} tintColor={theme.accent} />
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.heroBody}>
          {auth.trustLevel === 1
            ? '소셜 계정으로 로그인했어요. 이름과 나이는 아직 확인되지 않았어요.'
            : '앱에 등록된 현재 단계예요. 전화번호·신분증 확인 기록은 앱에서 조회할 수 없어요.'}
        </ThemedText>
        <View style={[styles.account, { borderTopColor: theme.line }]}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{auth.me.nickname.trim().slice(0, 1)}</ThemedText></View>
          <View style={styles.flex}><ThemedText type="smallBold">{auth.me.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{auth.trustLevel === 1 ? '확인된 조건 · 소셜 계정 로그인' : '현재 등록된 단계 · Lv' + auth.trustLevel}</ThemedText></View>
          {auth.trustLevel === 1 && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={20} tintColor={theme.accent} />}
        </View>
      </View>

      <View style={styles.sectionHead}><ThemedText type="subtitle" style={styles.sectionTitle}>단계별 인증 기준</ThemedText><ThemedText type="small" themeColor="textSecondary">눌러서 자세히 보기</ThemedText></View>
      <View style={[styles.levels, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {levels.map((item, index) => {
          const open = expanded === item.level;
          return <View key={item.level} style={[styles.level, index > 0 && { borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Lv${item.level} ${item.title}, ${item.level === auth.trustLevel ? '현재 단계' : item.level < auth.trustLevel ? '지난 단계' : '준비 중'}`} accessibilityState={{ expanded: open }}
              onPress={() => { play('selection'); if (!reducedMotion) { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } setExpanded(open ? null : item.level); }}
              style={({ pressed }) => [styles.levelButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <View style={[styles.number, { backgroundColor: item.level === auth.trustLevel ? theme.backgroundElement : theme.background, }]}><ThemedText type="smallBold" style={{ color: item.level === auth.trustLevel ? theme.accent : theme.textSecondary }}>{String(item.level).padStart(2, '0')}</ThemedText></View>
              <View style={styles.flex}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.summary}>{item.summary}</ThemedText></View>
              <ThemedText type="smallBold" style={{ color: item.level === auth.trustLevel ? theme.accent : theme.textSecondary }}>{item.level === auth.trustLevel ? '현재 단계' : item.level < auth.trustLevel ? '지난 단계' : '준비 중'}</ThemedText>
              <SymbolView name={{ ios: open ? 'chevron.down' : 'chevron.right', android: open ? 'keyboard_arrow_down' : 'chevron_right', web: open ? 'keyboard_arrow_down' : 'chevron_right' }} size={15} tintColor={theme.textSecondary} />
            </Pressable>
            {open && <View style={styles.detail}><ThemedText type="small" themeColor="textSecondary" style={styles.detailText}>{item.detail}</ThemedText>{item.level > 1 && <ThemedText type="small" themeColor="textSecondary" style={styles.availability}>지금은 앱에서 신청할 수 없어요.</ThemedText>}</View>}
          </View>;
        })}
      </View>

      <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.noteTitle}><SymbolView name={{ ios: 'info.circle', android: 'info_outline', web: 'info' }} size={17} tintColor={theme.textSecondary} /><ThemedText type="smallBold">인증 단계가 의미하는 것</ThemedText></View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.noteBody}>확인된 항목만 표시해요. 인증 단계는 만남의 안전이나 상대방의 행동을 보증하지 않아요. 이름·생년월일을 직접 입력해도 인증 단계는 올라가지 않아요.</ThemedText>
      </View>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth }, content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  eyebrow: { marginBottom: Spacing.two }, hero: { borderWidth: 1, borderRadius: 20, padding: Spacing.four }, heroHead: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }, flex: { flex: 1, minWidth: 0 }, heroTitle: { fontSize: 25, lineHeight: 32, fontWeight: '700', marginTop: Spacing.one }, heroIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, heroBody: { lineHeight: 21, marginTop: Spacing.two, marginBottom: Spacing.four }, account: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.five, marginBottom: Spacing.two }, sectionTitle: { fontSize: 17 }, levels: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' }, level: {}, levelButton: { minHeight: 77, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }, number: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, summary: { marginTop: Spacing.one }, detail: { paddingLeft: 64, paddingRight: Spacing.three, paddingBottom: Spacing.three }, detailText: { lineHeight: 20 }, availability: { marginTop: Spacing.two }, note: { borderRadius: 16, padding: Spacing.three, marginTop: Spacing.four }, noteTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, noteBody: { lineHeight: 19, marginTop: Spacing.two },
});

import { useLanguage } from '@/hooks/use-language';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSize } from '@/constants/design-system';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { loadMyTrustProgress, trustedHostSteps, type TrustedHostStep, type TrustProgress } from '@/lib/trust';

export default function TrustScreen() {
  const { tr } = useLanguage();
  const theme = useTheme();
  const auth = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<number | null>(1);
  const [progress, setProgress] = useState<TrustProgress | null>(null);
  useEffect(() => {
    if (!auth.isAuthed) return;
    let active = true;
    // A server without the RPC yet just hides the checklist; the rule text still explains Lv3.
    loadMyTrustProgress(supabase).then((value) => { if (active) setProgress(value); }, () => {});
    return () => { active = false; };
  }, [auth.isAuthed, auth.me.id, auth.trustLevel]);
  const hostStatus = progress && !progress.enabled ? tr("자동 배지는 잠시 멈춰 있어요.")
    : auth.trustLevel < 2 ? tr("Lv2를 마치면 내 기록으로 자동 계산해요.")
    : auth.trustLevel === 2 ? tr("기준을 다 채우면 한 시간 안에 배지가 붙어요.")
    : tr("기준에서 벗어나면 배지가 빠질 수 있어요.");
  const levels = [
    { level: 1, title: tr("계정 확인"), summary: tr("소셜 로그인 + 휴대폰 문자 인증"),
      checks: tr("Apple·카카오·Google 계정으로 로그인했는지 보고, 내 휴대폰 번호로 문자 인증 코드를 받아 확인해요."),
      keeps: tr("이름과 나이는 묻지 않아요. 휴대폰 번호는 다른 회원에게 보이지 않아요."),
      status: tr("소셜 로그인은 가입하면 바로 적용돼요. 문자 인증은 준비 중이에요.") },
    { level: 2, title: tr("신분증 확인"), summary: tr("신분증 + 얼굴 자동 대조"),
      checks: tr("전문 인증 업체가 신분증 사진과 그 자리에서 찍은 얼굴이 같은 사람인지 자동으로 대조하고, 성인인지도 확인해요."),
      keeps: tr("신분증과 얼굴 사진은 글링에 저장하지 않아요. 확인됐다는 사실과 성인 여부만 남겨요."),
      status: tr("준비 중이라 아직 앱에서 신청할 수 없어요.") },
    { level: 3, title: tr("믿을 수 있는 호스트"), summary: tr("Lv2 + 모임 참석·매너 기준"),
      checks: tr("Lv2를 마친 뒤 모임 참석 확인과 직접 연 모임 기록이 쌓이고, 최근에 노쇼·처리된 신고·낮은 매너 평가가 없으면 배지가 자동으로 붙어요."),
      keeps: tr("새로 받는 정보는 없어요. 다른 회원은 배지만 볼 수 있고, 노쇼나 신고 기록은 알 수 없어요."),
      status: hostStatus },
  ];
  const current = levels[auth.trustLevel - 1] ?? levels[0];
  const stepLabel = (step: TrustedHostStep) => step.key === 'level' ? tr("Lv2 신분증 확인")
    : step.key === 'confirmed' ? tr("모임 참석 확인 {0}/{1}번", step.count, step.required)
    : step.key === 'hosted' ? tr("참석자가 온 내 모임 {0}/{1}번", step.count, step.required)
    : step.key === 'noShow' ? tr("최근 {0}일 노쇼 없음", step.days)
    : tr("최근 {0}일 처리된 신고·낮은 매너 평가 없음", step.days);
  const levelState = (level: number) => level === auth.trustLevel ? tr("현재 단계") : level < auth.trustLevel ? tr("지난 단계")
    : level === 3 && auth.trustLevel === 2 ? tr("자동 계산") : tr("준비 중");

  if (!auth.isAuthed) return <LoginPanel reason="내 인증 단계를 확인하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.eyebrow}>{tr("내 계정의 인증 상태")}</ThemedText>
      <View style={[styles.hero, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={styles.heroHead}>
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">{tr("현재 단계")}</ThemedText>
            <ThemedText accessibilityRole="header" style={styles.heroTitle}>Lv{auth.trustLevel} · {current.title}</ThemedText>
          </View>
          <View style={[styles.heroIcon, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView name={{ ios: 'checkmark.seal', android: 'verified', web: 'verified' }} size={28} tintColor={theme.accent} />
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.heroBody}>
          {auth.trustLevel === 1
            ? tr("소셜 로그인은 확인됐어요. 휴대폰 문자 인증은 아직 준비 중이에요.")
            : tr("앱에 등록된 현재 단계예요. 신분증·얼굴 사진은 글링에 남기지 않아 앱에서도 볼 수 없어요.")}
        </ThemedText>
        <View style={[styles.account, { borderTopColor: theme.line }]}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{auth.me.nickname.trim().slice(0, 1)}</ThemedText></View>
          <View style={styles.flex}><ThemedText type="smallBold">{auth.me.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{auth.trustLevel === 1 ? tr("확인된 조건 · 소셜 계정 로그인") : tr("현재 등록된 단계 · Lv") + auth.trustLevel}</ThemedText></View>
          {auth.trustLevel === 1 && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={20} tintColor={theme.accent} />}
        </View>
      </View>

      <View style={styles.sectionHead}><ThemedText type="subtitle" style={styles.sectionTitle}>{tr("단계별 인증 기준")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr("눌러서 자세히 보기")}</ThemedText></View>
      <View style={[styles.levels, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {levels.map((item, index) => {
          const open = expanded === item.level;
          return <View key={item.level} style={[styles.level, index > 0 && { borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={tr("Lv{0} {1}, {2}", item.level, item.title, levelState(item.level))} accessibilityState={{ expanded: open }}
              onPress={() => { play('selection'); if (!reducedMotion) { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } setExpanded(open ? null : item.level); }}
              style={({ pressed }) => [styles.levelButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <View style={[styles.number, { backgroundColor: item.level === auth.trustLevel ? theme.backgroundElement : theme.background, }]}><ThemedText type="smallBold" style={{ color: item.level === auth.trustLevel ? theme.accent : theme.textSecondary }}>{String(item.level).padStart(2, '0')}</ThemedText></View>
              <View style={styles.flex}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.summary}>{item.summary}</ThemedText></View>
              <ThemedText type="smallBold" style={{ color: item.level === auth.trustLevel ? theme.accent : theme.textSecondary }}>{levelState(item.level)}</ThemedText>
              <SymbolView name={{ ios: open ? 'chevron.down' : 'chevron.right', android: open ? 'keyboard_arrow_down' : 'chevron_right', web: open ? 'keyboard_arrow_down' : 'chevron_right' }} size={15} tintColor={theme.textSecondary} />
            </Pressable>
            {open && <View style={styles.detail}>
              <ThemedText type="smallBold">{tr("확인하는 것")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.detailText}>{item.checks}</ThemedText>
              <ThemedText type="smallBold" style={styles.factLabel}>{tr("저장하지 않는 것")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.detailText}>{item.keeps}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.availability}>{item.status}</ThemedText>
              {item.level === 3 && progress && <View style={[styles.record, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">{tr("내 기록 · 나만 볼 수 있어요")}</ThemedText>
                {trustedHostSteps(progress).map((step) => <View key={step.key} accessible accessibilityLabel={`${stepLabel(step)}, ${step.met ? tr("완료") : tr("아직")}`} style={styles.step}>
                  <SymbolView name={step.met ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }} size={IconSize.inline} tintColor={step.met ? theme.accent : theme.textSecondary} />
                  <ThemedText type="small" style={styles.flex}>{stepLabel(step)}</ThemedText>
                </View>)}
              </View>}
            </View>}
          </View>;
        })}
      </View>

      <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.noteTitle}><SymbolView name={{ ios: 'info.circle', android: 'info_outline', web: 'info' }} size={17} tintColor={theme.textSecondary} /><ThemedText type="smallBold">{tr("인증 단계가 의미하는 것")}</ThemedText></View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.noteBody}>{tr("확인된 항목만 표시해요. 인증 단계는 만남의 안전이나 상대방의 행동을 보증하지 않아요. 이름·생년월일을 직접 입력해도 인증 단계는 올라가지 않아요.")}</ThemedText>
      </View>
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth }, content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five },
  eyebrow: { marginBottom: Spacing.two }, hero: { borderWidth: 1, borderRadius: 20, padding: Spacing.four }, heroHead: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }, flex: { flex: 1, minWidth: 0 }, heroTitle: { fontSize: 25, lineHeight: 32, fontWeight: '700', marginTop: Spacing.one }, heroIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, heroBody: { lineHeight: 21, marginTop: Spacing.two, marginBottom: Spacing.four }, account: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.five, marginBottom: Spacing.two }, sectionTitle: { fontSize: 17 }, levels: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' }, level: {}, levelButton: { minHeight: 77, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }, number: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, summary: { marginTop: Spacing.one }, detail: { paddingLeft: 64, paddingRight: Spacing.three, paddingBottom: Spacing.three }, detailText: { lineHeight: 20, marginTop: Spacing.half }, factLabel: { marginTop: Spacing.two }, availability: { marginTop: Spacing.two }, record: { borderRadius: 12, padding: Spacing.three, marginTop: Spacing.three, gap: Spacing.two }, step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, note: { borderRadius: 16, padding: Spacing.three, marginTop: Spacing.four }, noteTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, noteBody: { lineHeight: 19, marginTop: Spacing.two },
});

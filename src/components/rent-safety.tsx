import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { ListCard, ListRow } from '@/components/list-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const TIPS = [
  '디파짓이든 첫 달 월세든 집을 보고 나서 보내요. BC 경찰과 밴쿠버 경찰 안내에 모두 나오는 말이에요.',
  '집주인 사진 신분증을 보고, 계약서에 적힌 이름이랑 같은지 맞춰 봐요.',
  '광고 사진을 이미지 검색에 넣어 보면 다른 광고에서 가져온 사진인지 알 수 있어요.',
  '"오늘 안 보내면 다른 사람한테 넘어가요" 하고 재촉하면 한 번 더 의심해 봐요.',
  '계약서 없이 이사 들어가지 않아요. BC 표준 계약서(RTB-1)를 쓰면 기본 조항이 다 들어 있어요.',
  '이미 보냈다면 바로 은행에 전화하고, 캐나다 사기 신고 센터(1-888-495-8501)에도 알려요.',
];
const LINKS = [
  { label: 'BC 경찰 렌트 사기 안내', url: 'https://rcmp.ca/en/bc/safety-tips/frauds-and-scams/rental-scams' },
  { label: 'BC 디파짓 규칙', url: 'https://www2.gov.bc.ca/gov/content/housing-tenancy/residential-tenancies/starting-a-tenancy/deposits-and-fees' },
  { label: '사기 신고하기', url: 'https://antifraudcentre-centreantifraude.ca/report-signalez-eng.htm' },
];

// One line right above 대화하기 on a 렌트 내놓음 post: money talk starts in the chat.
export function RentScamNote({ onTips }: { onTips: () => void }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  return <View style={styles.note}>
    <SymbolView name={{ ios: 'shield', android: 'shield', web: 'shield' }} size={IconSize.inline} tintColor={theme.navy} />
    <View style={styles.flex}>
      <ThemedText type="small" themeColor="textSecondary">{tr('집을 직접 보기 전엔 돈을 보내지 마세요. BC에서는 디파짓이 첫 달 월세의 절반까지이고, 신청비는 받을 수 없어요.')}</ThemedText>
      <Pressable analyticsId="listing.rent.scam-tips" accessibilityRole="button" onPress={() => { play('selection'); onTips(); }}
        style={({ pressed }) => [styles.link, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
        <ThemedText type="smallBold" themeColor="accent">{tr('사기 피하는 법 ›')}</ThemedText>
      </Pressable>
    </View>
  </View>;
}

export function RentScamTipsSheet({ visible, onClose, onDismissed }: { visible: boolean; onClose: () => void; onDismissed?: () => void }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  return <DragSheet visible={visible} onClose={onClose} onDismissed={onDismissed} title={tr('렌트 사기 피하는 법')}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {TIPS.map((tip, index) => <View key={tip} style={styles.tip}>
        <View style={[styles.number, { backgroundColor: theme.backgroundSelected }]}><ThemedText type="micro" themeColor="accent" style={styles.numberText}>{index + 1}</ThemedText></View>
        <ThemedText type="small" style={styles.flex}>{tr(tip)}</ThemedText>
      </View>)}
      <ListCard>
        {LINKS.map(link => <ListRow key={link.url} analyticsId="listing.rent.scam-link" title={tr(link.label)}
          onPress={() => void Linking.openURL(link.url).catch(() => play('warning'))} />)}
      </ListCard>
    </ScrollView>
  </DragSheet>;
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  flex: { flex: 1, minWidth: 0 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  scroll: { flexShrink: 1 },
  content: { gap: 10, paddingBottom: Spacing.two },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  number: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  numberText: { fontWeight: '700' },
});

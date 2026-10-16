import { useLanguage } from '@/hooks/use-language';
import { useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { MannerSummary as Summary } from '@/lib/user-profile';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function MannerSummary({ summary }: { summary: Summary }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  return <View style={{ alignSelf: 'stretch', gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <ThemedText type="smallBold" style={{ flexShrink: 1 }}>{tr('이웃이 남긴 리뷰')}</ThemedText>
      <Pressable analyticsId="user.manner.criteria" accessibilityRole="button" accessibilityState={{ expanded: criteriaOpen }} onPress={() => { play('selection'); setCriteriaOpen(value => !value); }} style={{ minHeight: 44, justifyContent: 'center' }}><ThemedText type="small" themeColor="textSecondary">{tr('평점 기준')} ⓘ</ThemedText></Pressable>
    </View>
    <View style={{ flexDirection: 'row', padding: 16, borderRadius: 16, backgroundColor: theme.backgroundElement }}>
      {([['meeting', tr('만남')], ['chat', tr('대화')]] as const).map(([key, label], index) => {
        const rating = summary[key].rating ?? { participants: 0, score: null };
        const score = rating.participants >= 5 ? rating.score : null;
        return <View key={key} style={{ flex: 1, minWidth: 0, gap: 8, paddingRight: index === 0 ? 12 : 0, paddingLeft: index === 1 ? 16 : 0, borderRightWidth: index === 0 ? 1 : 0, borderRightColor: theme.line }}>
          <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
          <ThemedText type="smallBold" style={{ fontSize: score == null ? 14 : 22, lineHeight: 26 }}>{score == null ? tr(rating.participants ? '리뷰가 쌓이는 중' : '아직 리뷰가 없어요') : `${score.toLocaleString(appLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 10`}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11, lineHeight: 17 }}>{score == null ? tr('{0}명 참여 · 5명부터 평점 표시', rating.participants.toLocaleString(appLocale)) : tr('{0}명이 남긴 리뷰', rating.participants.toLocaleString(appLocale))}</ThemedText>
        </View>;
      })}
    </View>
    {criteriaOpen && <ThemedText type="small" themeColor="textSecondary">{tr("10점 만점 · 최근 30일 · 같은 상대는 한 번만 반영 · 서로 다른 5명부터 평점 표시. 활동 이력과 함께 참고해주세요.")}</ThemedText>}
  </View>;
}

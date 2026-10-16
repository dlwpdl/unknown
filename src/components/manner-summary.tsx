import { useLanguage } from '@/hooks/use-language';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { mannerLabel, type MannerSummary as Summary } from '@/lib/user-profile';
import { MerchantRatingBar } from '@/components/merchant-rating-bar';

export function MannerSummary({ summary }: { summary: Summary }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  return <View style={{ gap: 8, padding: 16, borderRadius: 16, backgroundColor: theme.backgroundElement }}>
    <ThemedText type="smallBold">{tr("글링 리뷰")}</ThemedText>
    {([['meeting', tr("참석 확인된 만남")], ['chat', tr("대화")]] as const).map(([key, label]) => <View key={key} style={{ gap: 4 }}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="subtitle">{mannerLabel(summary[key])}</ThemedText>
      <MerchantRatingBar score={summary[key].rating && summary[key].rating.participants >= 5 ? summary[key].rating.score : null} label={label} />
    </View>)}
    <ThemedText type="small" themeColor="textSecondary">{tr("10점 만점 · 최근 30일 · 같은 상대는 한 번만 반영 · 서로 다른 5명부터 평점 표시. 활동 이력과 함께 참고해주세요.")}</ThemedText>
  </View>;
}

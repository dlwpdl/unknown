import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Pressable } from '@/components/analytics-controls';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { MerchantProfile } from '@/lib/merchant-profile';
import type { MerchantReviewKind, MerchantReviewPage } from '@/lib/merchant-reviews';

type Props = { profile: MerchantProfile; ratings?: Partial<Record<MerchantReviewKind, Pick<MerchantReviewPage, 'rating_average' | 'review_count'> | null>>; onReviewPress?: (kind: MerchantReviewKind) => void };

export function MerchantProfileHeader({ profile, ratings, onReviewPress }: Props) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [linkError, setLinkError] = useState('');
  return <View style={styles.profile}>
    <View style={[styles.banner, { backgroundColor: theme.card }]}>
      {profile.bannerUri ? <Image source={{ uri: profile.bannerUri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={`${profile.name} 배너`} />
        : <ThemedText style={[styles.bannerG, { color: theme.accent }]} accessible={false}>gling.</ThemedText>}
    </View>
    <View style={styles.identity}>
      <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
        {profile.avatarUri ? <Image source={{ uri: profile.avatarUri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={`${profile.name} 로고`} />
          : <ThemedText type="title" style={{ color: theme.accentInk }} accessible={false}>{profile.name.slice(0, 1)}</ThemedText>}
      </View>
      <View style={styles.name}>
        <ThemedText type="subtitle">{profile.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{[profile.city_name, profile.industry].filter(Boolean).join(' · ')}</ThemedText>
      </View>
      {onReviewPress && <View style={styles.ratings}>{(['usage', 'employment'] as const).map(kind => {
        const rating = ratings?.[kind], average = rating?.rating_average ?? null, label = kind === 'usage' ? '상품·서비스' : '근무';
        const score = rating === undefined ? '…' : average == null ? '—' : (Math.round(average * 10) / 10).toFixed(1);
        return <Pressable key={kind} analyticsId={`company.rating.${kind}`} accessibilityRole="button"
          accessibilityLabel={`${label} 리뷰 보기, ${rating === undefined ? '불러오는 중' : rating === null ? '점수를 다시 확인해 주세요' : average == null ? '점수 없음' : `10점 만점에 평균 ${score}점, 인증 후기 ${rating.review_count}개`}`}
          style={styles.rating} onPress={() => { play('selection'); onReviewPress(kind); }}>
          {kind === 'usage' ? <ThemedText style={styles.spark} themeColor="accent" accessible={false}>✦</ThemedText>
            : <View style={styles.briefcase} accessible={false}>
              <View style={[styles.caseHandle, { borderColor: theme.accent }]} />
              <View style={[styles.caseBody, { borderColor: theme.accent }]}>
                <View style={[styles.caseDivider, { borderColor: theme.accent }]} />
              </View>
            </View>}
          <ThemedText type="smallBold" themeColor="accent">{score}</ThemedText>
        </Pressable>;
      })}</View>}
    </View>
    {!!profile.services && <ThemedText>{profile.services}</ThemedText>}
    {!!profile.address && <ThemedText type="small" themeColor="textSecondary">{profile.address}</ThemedText>}
    {!!profile.links?.length && <View style={styles.links}>{profile.links.map(link => <Pressable key={link.url}
      analyticsId="company.source" accessibilityRole="link" accessibilityLabel={`${profile.name} ${link.label}, 외부 페이지 열기`}
      style={[styles.link, { borderColor: theme.line }]} onPress={() => {
        play('selection'); setLinkError('');
        void Linking.openURL(link.url).catch(() => { setLinkError(link.url); play('warning'); });
      }}><ThemedText type="smallBold" themeColor="accent">{link.label} ↗</ThemedText></Pressable>)}</View>}
    {profile.links?.some(link => link.url === linkError) && <ThemedText type="small" accessibilityRole="alert">업체 페이지를 열지 못했어요. 다시 눌러 주세요.</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  profile: { gap: 16 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: 12 },
  banner: { width: '100%', aspectRatio: 3.2, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  bannerG: { fontSize: 38, lineHeight: 44, fontWeight: '800', opacity: 0.35 },
  identity: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  avatar: { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 60, gap: 4 },
  ratings: { flexDirection: 'row', maxWidth: '100%', marginLeft: 'auto', gap: 2 },
  rating: { flexDirection: 'row', minWidth: 44, minHeight: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 4 },
  spark: { width: 16, fontSize: 16, lineHeight: 18, textAlign: 'center' },
  briefcase: { width: 16, height: 16 },
  caseHandle: { position: 'absolute', left: 4.5, top: 0, width: 7, height: 5, borderWidth: 1.3, borderRadius: 1.5 },
  caseBody: { position: 'absolute', left: 1, top: 3, width: 14, height: 12, borderWidth: 1.3, borderRadius: 2 },
  caseDivider: { height: 4, borderBottomWidth: 1.3 },
});

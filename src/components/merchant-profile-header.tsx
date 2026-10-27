import { useLanguage } from '@/hooks/use-language';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Pressable } from '@/components/analytics-controls';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { MerchantProfile } from '@/lib/merchant-profile';
import type { MerchantReviewKind, MerchantReviewPage } from '@/lib/merchant-reviews';
import { MerchantRatingBar } from '@/components/merchant-rating-bar';

type Props = { profile: MerchantProfile; ratings?: Partial<Record<MerchantReviewKind, Pick<MerchantReviewPage, 'rating_average' | 'review_count'> | null>>; onReviewPress?: (kind: MerchantReviewKind) => void };

export function MerchantProfileHeader({ profile, ratings, onReviewPress }: Props) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [linkError, setLinkError] = useState('');
  const [failedImage, setFailedImage] = useState<{ avatar?: string; banner?: string }>({});
  return <View style={styles.profile}>
    <View style={styles.identity}>
      <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
        {profile.avatarUri && failedImage.avatar !== profile.avatarUri ? <Image source={{ uri: profile.avatarUri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={tr("{0} 로고", (profile.name))}
          onError={() => setFailedImage(value => ({ ...value, avatar: profile.avatarUri! }))} />
          : <ThemedText type="title" style={{ color: theme.accentInk }} accessible={false}>{profile.name.slice(0, 1)}</ThemedText>}
      </View>
      <View style={styles.name}>
        <ThemedText type="subtitle" style={styles.businessName}>{profile.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{[profile.city_name, profile.industry].filter(Boolean).join(' · ')}</ThemedText>
      </View>
      {onReviewPress && <View style={styles.ratings}>{(['usage', 'employment'] as const).map((kind, index) => {
        const rating = ratings?.[kind], average = rating?.rating_average ?? null, label = tr(kind === 'usage' ? '상품·서비스 후기' : '직원 후기');
        const score = average == null ? null : (Math.round(average * 10) / 10).toFixed(1);
        const value = rating === undefined ? '…' : rating === null ? tr('다시 확인해 주세요') : score == null ? tr('–/10 · 아직 없어요') : tr('{0}/10 · {1}개', score, rating.review_count);
        return <Pressable key={kind} analyticsId={`company.rating.${kind}`} accessibilityRole="button"
          accessibilityLabel={tr("{0} 보기, {1}", (label), (rating === undefined ? tr('불러오는 중') : rating === null ? tr('점수를 다시 확인해 주세요') : score == null ? tr('아직 후기가 없어요') : tr('10점 만점에 평균 {0}점, 인증 후기 {1}개', score, rating.review_count)))}
          style={({ pressed }) => [styles.rating, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, { opacity: pressed ? 0.82 : 1 }]}
          onPress={() => { play('selection'); onReviewPress(kind); }}>
          <ThemedText type="smallBold" style={styles.ratingLabel}>{label}</ThemedText>
          <MerchantRatingBar score={average} reviewKind={kind} label={label} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.ratingValue}>{value}</ThemedText>
          <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
        </Pressable>;
      })}</View>}
    </View>
    <View style={[styles.banner, { backgroundColor: theme.card }]}>
      {profile.bannerUri && failedImage.banner !== profile.bannerUri ? <Image source={{ uri: profile.bannerUri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={tr("{0} 배너", (profile.name))}
        onError={() => setFailedImage(value => ({ ...value, banner: profile.bannerUri! }))} />
        : <ThemedText style={[styles.bannerG, { color: theme.accent }]} accessible={false}>gling.</ThemedText>}
    </View>
    {!!profile.services && <ThemedText>{profile.services}</ThemedText>}
    {!!profile.address && <ThemedText type="small" themeColor="textSecondary">{profile.address}</ThemedText>}
    {!!profile.links?.length && <View style={styles.links}>{profile.links.map(link => <Pressable key={link.url}
      analyticsId="company.source" accessibilityRole="link" accessibilityLabel={tr("{0} {1}, 외부 페이지 열기", (profile.name), (link.label))}
      style={[styles.link, { borderColor: theme.line }]} onPress={() => {
        play('selection'); setLinkError('');
        void Linking.openURL(link.url).catch(() => { setLinkError(link.url); play('warning'); });
      }}><ThemedText type="smallBold" themeColor="accent">{link.label} ↗</ThemedText></Pressable>)}</View>}
    {profile.links?.some(link => link.url === linkError) && <ThemedText type="small" accessibilityRole="alert">{tr("비즈니스 페이지를 열지 못했어요. 다시 눌러 주세요.")}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  profile: { gap: 22 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: 12 },
  banner: { width: '100%', aspectRatio: 1.18, maxHeight: 360, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  bannerG: { fontSize: 38, lineHeight: 44, fontWeight: '800', opacity: 0.35 },
  identity: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: 9 },
  businessName: { fontSize: 34, lineHeight: 43, letterSpacing: -1.6, fontWeight: '600' },
  ratings: { width: '100%' },
  rating: { flexDirection: 'row', minHeight: 44, alignItems: 'center', gap: 10 },
  ratingLabel: { minWidth: 104 },
  ratingValue: { flex: 1 },
});

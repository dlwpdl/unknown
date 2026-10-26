import { Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CHILLING_PROMPTS, type ChillingProfile } from '@/lib/chilling-data';
import { CITIES } from '@/lib/mock';

export function ChillingProfileCard({ profile }: { profile: ChillingProfile }) {
  const { tr, language } = useLanguage();
  const theme = useTheme();
  const city = CITIES.find(value => value.id === profile.cityId);
  return <View style={styles.card}>
    <View style={styles.identity}>
      {profile.photoUris?.[0] ? <Image source={{ uri: profile.photoUris[0] }} cachePolicy="none" style={styles.avatar} contentFit="cover" accessibilityLabel={tr("{0} 모임 사진", profile.displayName || tr("모임 멤버"))} />
        : <View style={[styles.avatar, styles.initial, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle">{profile.displayName?.slice(0, 1) || '✦'}</ThemedText></View>}
      <View style={styles.identityBody}><ThemedText type="smallBold" themeColor="accent" style={styles.label}>{tr("모임 프로필")}</ThemedText><ThemedText type="subtitle" style={styles.name}>{profile.displayName || tr("모임 멤버")}</ThemedText>
        {profile.cityId && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("활동 지역 ·") + " "}{(language === 'en' ? city?.englishName : city?.name) ?? profile.cityId}</ThemedText>}
      </View>
    </View>
    {!!profile.photoUris?.slice(1).some(Boolean) && <View style={styles.interests}>{profile.photoUris.slice(1).map((uri, index) => uri && <Image key={index} source={{ uri }} cachePolicy="none" style={styles.extraPhoto} contentFit="cover" accessibilityLabel={tr("모임 사진 {0}", index + 2)} />)}</View>}
    {!!profile.intro && <ThemedText style={[styles.bodyText, styles.intro]}>{profile.intro}</ThemedText>}
    {profile.interests.length > 0 && <View style={styles.interests}>{profile.interests.map(interest => <View key={interest} style={[styles.interest, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" themeColor="accent" style={styles.label}>{interest}</ThemedText></View>)}</View>}
    {[[tr(CHILLING_PROMPTS[profile.promptOneId ?? 'meet']), profile.promptOne], [tr(CHILLING_PROMPTS[profile.promptTwoId ?? 'join']), profile.promptTwo]].filter(([, answer]) => !!answer).map(([question, answer]) =>
      <View key={question} style={[styles.prompt, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="accent" style={styles.label}>{question}</ThemedText>
        <ThemedText style={[styles.bodyText, styles.answer]}>{answer}</ThemedText>
      </View>)}
  </View>;
}
const styles = StyleSheet.create({
  label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 },
  card: { gap: Spacing.three }, prompt: { borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  name: { fontSize: 24, lineHeight: 30 }, intro: { fontSize: 17, lineHeight: 25 }, answer: { fontSize: 17, lineHeight: 25 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, identityBody: { flex: 1, gap: Spacing.one },
  avatar: { width: 72, height: 72, borderRadius: 24 }, initial: { alignItems: 'center', justifyContent: 'center' },
  extraPhoto: { width: 96, height: 112, borderRadius: 16 },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, interest: { borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});

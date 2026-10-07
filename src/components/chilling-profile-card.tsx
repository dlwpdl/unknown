import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ChillingProfile } from '@/lib/chilling-data';
import { CITIES } from '@/lib/mock';

export function ChillingProfileCard({ profile, identity }: { profile: ChillingProfile; identity?: { nickname: string; photoUri?: string | null; cityId?: string } }) {
  const theme = useTheme();
  return <View style={styles.card}>
    {identity && <View style={styles.identity}>
      {identity.photoUri ? <Image source={{ uri: identity.photoUri }} style={styles.avatar} contentFit="cover" accessibilityLabel={`${identity.nickname} 프로필 사진`} />
        : <View style={[styles.avatar, styles.initial, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle">{identity.nickname.slice(0, 1)}</ThemedText></View>}
      <View style={styles.identityBody}><ThemedText type="subtitle" style={styles.name}>{identity.nickname}</ThemedText>
        {identity.cityId && <ThemedText type="small" themeColor="textSecondary">활동 지역 · {CITIES.find(city => city.id === identity.cityId)?.name ?? identity.cityId}</ThemedText>}
      </View>
    </View>}
    <ThemedText style={styles.intro}>{profile.intro || '한 줄 소개를 작성해 주세요.'}</ThemedText>
    <View style={styles.interests}>{profile.interests.map(interest => <View key={interest} style={[styles.interest, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" themeColor="accent">{interest}</ThemedText></View>)}</View>
    {[['나랑 만나면 주로…', profile.promptOne], ['이런 모임이면 바로 신청해요', profile.promptTwo]].map(([question, answer]) =>
      <View key={question} style={[styles.prompt, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="accent">{question}</ThemedText>
        <ThemedText style={styles.answer}>{answer}</ThemedText>
      </View>)}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: Spacing.three }, prompt: { borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  name: { fontSize: 24, lineHeight: 30 }, intro: { fontSize: 17, lineHeight: 25 }, answer: { fontSize: 17, lineHeight: 25 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, identityBody: { flex: 1, gap: Spacing.one },
  avatar: { width: 72, height: 72, borderRadius: 24 }, initial: { alignItems: 'center', justifyContent: 'center' },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, interest: { borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});

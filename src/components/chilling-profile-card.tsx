import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ChillingProfile } from '@/lib/chilling-data';

export function ChillingProfileCard({ profile }: { profile: ChillingProfile }) {
  const theme = useTheme();
  return <View style={styles.card}>
    <ThemedText type="subtitle">{profile.intro}</ThemedText>
    <ThemedText type="small" themeColor="accent">{profile.interests.join(' · ')}</ThemedText>
    {[['나랑 만나면 주로…', profile.promptOne], ['이런 모임이면 바로 신청해요', profile.promptTwo]].map(([question, answer]) =>
      <View key={question} style={[styles.prompt, { borderColor: theme.line }]}>
        <ThemedText type="smallBold" themeColor="accent">{question}</ThemedText>
        <ThemedText style={styles.answer}>{answer}</ThemedText>
      </View>)}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: Spacing.three }, prompt: { borderTopWidth: 1, paddingTop: Spacing.three, gap: Spacing.two },
  answer: { fontSize: 21, lineHeight: 32 },
});

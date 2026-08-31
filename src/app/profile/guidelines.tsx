import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';

export default function GuidelinesScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{t.profile.guidelinesTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t.profile.guidelinesIntro}
          </ThemedText>

          <View style={styles.rules}>
            {t.profile.guidelineRules.map((rule, index) => (
              <View key={rule.title} style={[styles.rule, { borderBottomColor: theme.line }]}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {index + 1}
                </ThemedText>
                <View style={styles.ruleCopy}>
                  <ThemedText type="smallBold">{rule.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {rule.body}
                  </ThemedText>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.four, gap: Spacing.two },
  rules: { marginTop: Spacing.three },
  rule: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: 1 },
  ruleCopy: { flex: 1, gap: Spacing.one },
});

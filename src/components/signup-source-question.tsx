import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollView } from '@/components/analytics-controls';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { SIGNUP_SOURCES, type SignupSource } from '@/lib/signup-source';
import { supabase } from '@/lib/supabase';

const THANKS_MS = 1000;

// Asked once, right after the profile exists. Nothing here can fail the signup: the answer is sent best effort.
export function SignupSourceQuestion({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [choice, setChoice] = useState<SignupSource | null>(null);
  const [farewell, setFarewell] = useState<'thanks' | 'skipped' | null>(null);
  const [fade] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = (kind: 'thanks' | 'skipped') => {
    if (farewell) return;
    setFarewell(kind);
    if (!reducedMotion) Animated.timing(fade, { toValue: 1, duration: ControlMotion.settleMs, useNativeDriver: true }).start();
    timer.current = setTimeout(onDone, THANKS_MS);
  };
  const submit = () => {
    if (!choice || farewell) return;
    play('success');
    // Not awaited and errors ignored, like analytics.
    void Promise.resolve(supabase.rpc('record_signup_source', { p_answer: choice })).catch(() => {});
    finish('thanks');
  };
  const skip = () => {
    if (farewell) return;
    play('selection');
    finish('skipped');
  };

  return <SafeAreaView style={styles.safeArea}>
    <ScrollView analyticsId="components_signup-source-question.scrollview.1" contentContainerStyle={styles.content}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.onboarding.sourceStep}</ThemedText>
      <View style={styles.copy}>
        <ThemedText type="title" style={styles.title}>{t.onboarding.sourceTitle}</ThemedText>
        <ThemedText themeColor="textSecondary">{t.onboarding.sourceBody}</ThemedText>
      </View>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {SIGNUP_SOURCES.map((key) => <SelectionChip key={key} analyticsId={`components_signup-source-question.chip.${key}`}
          label={t.onboarding.sourceOptions[key]} selected={choice === key} disabled={farewell != null}
          accessibilityRole="radio" accessibilityState={{ selected: choice === key, disabled: farewell != null }}
          onPress={() => { play('selection'); setChoice(key); }} />)}
      </View>
      <View style={styles.actions}>
        <RaisedActionButton analyticsId="components_signup-source-question.submit" label={t.onboarding.sourceSubmit} disabled={!choice || farewell != null} onPress={submit} />
        <RaisedActionButton analyticsId="components_signup-source-question.skip" tone="secondary" label={t.onboarding.sourceSkip} disabled={farewell != null} onPress={skip} />
      </View>
      <View accessibilityLiveRegion="polite" style={styles.farewell}>
        {farewell && <Animated.View style={{ opacity: fade }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{farewell === 'thanks' ? t.onboarding.sourceThanks : t.onboarding.sourceSkipped}</ThemedText>
        </Animated.View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.five },
  copy: { gap: Spacing.two },
  title: { fontSize: 32, lineHeight: 39, fontWeight: 700 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: { gap: Spacing.two },
  farewell: { minHeight: 24, alignItems: 'center' },
});

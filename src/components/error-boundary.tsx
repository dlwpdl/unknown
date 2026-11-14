import { tr } from '@/i18n';
import { Pressable } from '@/components/analytics-controls';
import { useRouter } from 'expo-router';
import { Component, useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { reportError } from '@/lib/error-reporting';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const TITLE = "화면을 그리지 못했어요";
const BODY = "문제는 저희에게 전달됐어요. 다시 시도해 보시고, 계속 이러면 앱을 껐다 켜주세요.";

// 렌더 중 오류가 나면 React 는 화면을 통째로 비운다. 사용자에게는 앱이 죽은 것으로 보인다.
// 대신 다시 시도할 자리를 주고, 무슨 일이 있었는지 서버로 보낸다.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'render');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <RootFallback onRetry={() => this.setState({ failed: false })} />;
  }
}

// The whole app failed: only the theme is still above this, so it draws with theme colours and no feedback provider (QA I-error-01).
function RootFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return <View style={[styles.screen, { backgroundColor: theme.background }]}>
    <ThemedText type="smallBold" style={styles.title}>{tr(TITLE)}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary" style={styles.body}>{tr(BODY)}</ThemedText>
    <Pressable analyticsId="components_error-boundary.pressable.1" onPress={onRetry} accessibilityRole="button"
      style={({ pressed }) => [styles.retry, { backgroundColor: theme.accent }, pressed && { opacity: 0.7 }]}>
      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("다시 시도")}</ThemedText>
    </Pressable>
  </View>;
}

/** One screen failed (expo-router screenErrorBoundary): retry it, or step back to the screen before it or home. */
export function ScreenErrorFallback({ error, retry }: { error: Error; retry: () => unknown }) {
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  // expo-router's boundary does not report, so the screen does once per error.
  useEffect(() => { reportError(error, 'render'); }, [error]);
  const back = router.canGoBack();
  return <View style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={styles.card}>
      <StateCard kind="error" title={tr(TITLE)} body={tr(BODY)} actionLabel={tr("다시 시도")} onAction={() => void retry()} analyticsId="components_error-boundary.pressable.1">
        <RaisedActionButton compact tone="secondary" analyticsId="components_error-boundary.pressable.1" label={back ? tr("뒤로 가기") : tr("홈으로")}
          onPress={() => { play('selection'); if (back) router.back(); else router.replace('/'); }} />
      </StateCard>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  card: { width: '100%', maxWidth: Math.min(MaxContentWidth, 420) },
  title: { fontSize: 16 },
  body: { textAlign: 'center', maxWidth: 320 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.four, marginTop: Spacing.two, borderRadius: 999 },
});

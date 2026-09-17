import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { reportError } from '@/lib/error-reporting';

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
    return (
      <View style={styles.screen}>
        <ThemedText type="smallBold" style={styles.title}>화면을 그리지 못했어요</ThemedText>
        <ThemedText type="small" style={styles.body}>
          문제는 저희에게 전달됐어요. 다시 시도해 보시고, 계속 이러면 앱을 껐다 켜주세요.
        </ThemedText>
        <Pressable
          onPress={() => this.setState({ failed: false })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}>
          <ThemedText type="smallBold" style={styles.retryText}>다시 시도</ThemedText>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four, backgroundColor: Colors.light.background },
  title: { fontSize: 16 },
  body: { color: Colors.light.textSecondary, textAlign: 'center', maxWidth: 320 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.four, marginTop: Spacing.two, borderRadius: 999, backgroundColor: Colors.light.accent },
  retryText: { color: Colors.light.accentInk },
});

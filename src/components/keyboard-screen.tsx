import { type ReactNode, useState } from 'react';
import { Dimensions, KeyboardAvoidingView, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

// Android edge-to-edge no longer shrinks the window for the keyboard. A stack header above the screen is not in the avoider's frame, so the offset comes from the real position on screen.
export function KeyboardScreen({ children }: { children: ReactNode }) {
  const [offset, setOffset] = useState(0);
  // Inside an iPhone sheet, measureInWindow starts at the sheet's top. The sheet's SafeAreaProvider is shorter than the window by exactly the gap it misses.
  const { height } = useSafeAreaFrame();
  const sheetGap = Platform.OS === 'ios' ? Math.max(0, Dimensions.get('window').height - height) : 0;
  return <View style={styles.fill} onLayout={event => {
    if (Platform.OS === 'web') return;
    const target = event.currentTarget;
    if (typeof target === 'number') UIManager.measureInWindow(target, (_x, y) => setOffset(y));
    else target.measureInWindow((_x, y) => setOffset(y));
  }}>
    <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={offset + sheetGap}>{children}</KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

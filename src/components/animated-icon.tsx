import * as SplashScreen from 'expo-splash-screen';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

const DURATION = 300;

export function AnimatedSplashOverlay() {
  const [visible, setVisible] = useState(true);
  const hiding = useRef(false);
  const [opacity] = useState(() => new Animated.Value(1));

  if (!visible) return null;

  return (
    <Animated.View
      onLayout={() => {
        if (hiding.current) return;
        hiding.current = true;
        SplashScreen.hideAsync().finally(() => {
          Animated.timing(opacity, {
            toValue: 0,
            duration: DURATION,
            useNativeDriver: true,
          }).start(() => setVisible(false));
        });
      }}
      style={[styles.overlay, { opacity }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Image
        source={require('@/assets/brand/gling-mark-light.png')}
        style={styles.mark}
        contentFit="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#BE3B2A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  mark: { width: 128, height: 128 },
});

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ControlMotion } from '@/constants/design-system';
import { fillsParent, flatControlStyle, pressedScale } from '@/lib/flat-control';

type Props = ComponentProps<typeof Pressable>;

function WebFlatPressable({ style, ...props }: Props) {
  return <Pressable {...props} style={state => {
    const original = typeof style === 'function' ? style(state) : style;
    const flat = StyleSheet.flatten(original);
    return [original, state.pressed && (flat?.opacity == null || flat.opacity === 1) && { opacity: ControlMotion.pressedOpacity }, flatControlStyle(flat ?? undefined)];
  }} />;
}

const AnimatedPressable = Platform.OS === 'web' ? null : Animated.createAnimatedComponent(Pressable);

/** Every tappable control shrinks slightly while held, with no extra layout container. Reduced motion keeps only the opacity response. */
function NativeFlatPressable({ style, onPressIn, onPressOut, onLayout, ...props }: Props) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1)), [pressed, setPressed] = useState(false);
  const width = useRef(0);
  const blocked = !!props.disabled;
  // Becoming disabled mid-press drops the pressed look right away; the scale resets after the render.
  const [wasBlocked, setWasBlocked] = useState(blocked);
  if (blocked !== wasBlocked) { setWasBlocked(blocked); if (blocked) setPressed(false); }
  useEffect(() => { if (blocked) scale.setValue(1); }, [blocked, scale]);
  // Web style callbacks may read hovered; native Pressable types only know pressed, so pass a variable, not a literal.
  const state = { pressed, hovered: false };
  const original = typeof style === 'function' ? style(state) : style;
  const flat = StyleSheet.flatten(original) ?? undefined;
  const shrinks = !reduced && !blocked && !!(props.onPress || props.onLongPress) && !fillsParent(flat);
  const settle = (toValue: number, duration: number) => Animated.timing(scale, { toValue, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  const release = () => Animated.spring(scale, { toValue: 1, ...ControlMotion.releaseSpring, useNativeDriver: true }).start();
  const Control = AnimatedPressable!;
  return <Control {...props}
    onLayout={event => { width.current = event.nativeEvent.layout.width; onLayout?.(event); }}
    onPressIn={event => { setPressed(true); if (shrinks) settle(pressedScale(width.current), ControlMotion.pressMs); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); release(); onPressOut?.(event); }}
    style={[original, pressed && !blocked && (flat?.opacity == null || flat.opacity === 1) && { opacity: ControlMotion.pressedOpacity }, flatControlStyle(flat),
      shrinks && { transform: [...(Array.isArray(flat?.transform) ? flat.transform : []), { scale }] }]} />;
}

export const FlatPressable = Platform.OS === 'web' ? WebFlatPressable : NativeFlatPressable;

import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ControlMotion } from '@/constants/design-system';
import { flatControlStyle } from '@/lib/flat-control';

// Web has no press scale, so this file keeps the native one's reduced-motion check (and its ~130 KB gzip animation library) off every web page.
export function FlatPressable({ style, ...props }: ComponentProps<typeof Pressable>) {
  return <Pressable {...props} style={state => {
    const original = typeof style === 'function' ? style(state) : style;
    const flat = StyleSheet.flatten(original);
    return [original, state.pressed && (flat?.opacity == null || flat.opacity === 1) && { opacity: ControlMotion.pressedOpacity }, flatControlStyle(flat ?? undefined)];
  }} />;
}

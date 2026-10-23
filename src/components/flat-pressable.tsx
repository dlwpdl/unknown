import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { flatControlStyle } from '@/lib/flat-control';

export function FlatPressable({ style, ...props }: ComponentProps<typeof Pressable>) {
  return <Pressable {...props} style={state => {
    const original = typeof style === 'function' ? style(state) : style;
    const flat = StyleSheet.flatten(original);
    return [original, state.pressed && (flat?.opacity == null || flat.opacity === 1) && { opacity: 0.82 }, flatControlStyle(flat)];
  }} />;
}

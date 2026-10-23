import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { lensControlStyle } from '@/lib/lens-control';

export function LensPressable({ style, ...props }: ComponentProps<typeof Pressable>) {
  return <Pressable {...props} style={state => {
    const original = typeof style === 'function' ? style(state) : style;
    return [original, lensControlStyle(StyleSheet.flatten(original) ?? undefined, state.pressed)];
  }} />;
}

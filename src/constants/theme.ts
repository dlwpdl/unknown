/**
 * 글링 디자인 토큰 — landing/index.html 팔레트와 동일 계열.
 * 템플릿 키(text/background/...)는 유지하고 브랜드 키를 추가했다.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#21252C',              // ink
    background: '#FAF9F5',        // paper
    backgroundElement: '#F1EFE8', // chip
    backgroundSelected: '#E8E5DC',
    textSecondary: '#5B6270',     // sub
    card: '#FFFFFF',
    line: '#E5E3DB',
    accent: '#BE3B2A',            // 인주
    accentInk: '#FFFFFF',
    navy: '#34506B',
  },
  dark: {
    text: '#EAE9E2',
    background: '#15181C',
    backgroundElement: '#23272E',
    backgroundSelected: '#2B3037',
    textSecondary: '#9AA0A8',
    card: '#1C2026',
    line: '#2B3037',
    accent: '#E15A44',
    accentInk: '#1A0E0B',
    navy: '#8FB0CC',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// 네이티브 탭바 자체 높이 (세이프에어리어 제외). 실제 하단 점유 = TabBarHeight + insets.bottom
export const TabBarHeight = Platform.select({ ios: 49, android: 64 }) ?? 49;
export const MaxContentWidth = 800;

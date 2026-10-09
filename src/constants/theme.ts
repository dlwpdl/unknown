/** 글링 앱 테마와 별도의 관리자 전용 밝은 테마. */

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
    accentDepth: '#8B2D25',
    accentInk: '#FFFFFF',
    navy: '#34506B',
  },
  dark: {
    text: '#F6F3F0',
    background: '#0B0B12',
    backgroundElement: '#222231',
    backgroundSelected: '#343443',
    textSecondary: '#B7B4C3',
    card: '#171722',
    line: '#343443',
    accent: '#CBB9FF',
    accentDepth: '#8169B1',
    accentInk: '#171123',
    navy: '#B9C8FF',
  },
  admin: {
    text: '#252631',
    background: '#F6F7FA',
    backgroundElement: '#F0F1F5',
    backgroundSelected: '#EDE9F7',
    textSecondary: '#656A7A',
    card: '#FFFFFF',
    line: '#E2E4EC',
    accent: '#6550A6',
    accentDepth: '#4F3D87',
    accentInk: '#FFFFFF',
    navy: '#3C5D8E',
    danger: '#B33246',
    dangerBackground: '#FBEFF1',
    success: '#257454',
    successBackground: '#EBF5EF',
    warning: '#896016',
    warningBackground: '#FCF5E6',
  },
} as const;

// Minimal cinematic palette for the public web reader, landing, and legal pages.
export const WebNightColors = {
  text: '#ECE8E5',
  background: '#0D0C10',
  backgroundElement: '#26212C',
  backgroundSelected: '#36303F',
  textSecondary: '#B4ADB8',
  card: '#19161E',
  line: '#36303F',
  accent: '#9283AC',
  accentFill: '#746486',
  accentInk: '#F1EDF5',
  navy: '#B9C8FF',
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

// 같은 높이의 표면은 앱 어디서든 같은 그림자와 눌림 깊이를 쓴다.
export const Depth = {
  card: { shadowColor: '#000000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 5 },
  control: { shadowColor: '#000000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 7, elevation: 3 },
} as const;

// 네이티브 탭바 자체 높이 (세이프에어리어 제외). 실제 하단 점유 = TabBarHeight + insets.bottom
export const TabBarHeight = Platform.select({ ios: 49, android: 64 }) ?? 49;
export const MaxContentWidth = 800;

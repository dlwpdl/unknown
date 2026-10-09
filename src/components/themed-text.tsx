import { Children } from 'react';
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ children, style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      lineBreakStrategyIOS="hangul-word"
      accessibilityLabel={Platform.OS === 'android' && typeof children === 'string' ? children : undefined}
      style={[
        { color: theme[themeColor ?? 'text'] },
        Platform.OS === 'web' && styles.wordWrap,
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    >
      {Platform.OS === 'android'
        // Android has no Hangul word-break prop; join displayed syllables without changing stored text.
        ? Children.map(children, child => typeof child === 'string' ? child.replace(/([가-힣])(?=[가-힣])/g, '$1\u2060') : child)
        : children}
    </Text>
  );
}

const styles = StyleSheet.create({
  wordWrap: { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as TextStyle,
  small: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: 700,
  },
  default: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: 500,
  },
  title: {
    fontSize: 32,
    fontWeight: 600,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});

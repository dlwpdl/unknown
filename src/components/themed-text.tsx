import { Children } from 'react';
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code' | 'screenTitle' | 'sheetTitle' | 'section' | 'menu' | 'label' | 'supporting' | 'caption' | 'micro';
  themeColor?: ThemeColor;
};

export function ThemedText({ children, style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  // Display sizes are already large; uncapped they wrap screen titles to three lines at accessibility sizes. Body text still scales fully.
  const display = (StyleSheet.flatten([styles[type], style])?.fontSize ?? 0) >= 24;

  return (
    <Text
      lineBreakStrategyIOS="hangul-word"
      accessibilityLabel={Platform.OS === 'android' && typeof children === 'string' ? children : undefined}
      style={[
        { color: theme[themeColor ?? 'text'] },
        Platform.OS === 'web' && styles.wordWrap,
        styles[type],
        style,
      ]}
      maxFontSizeMultiplier={display ? 1.3 : undefined}
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
  small: Typography.supporting,
  smallBold: Typography.label,
  default: Typography.body,
  title: Typography.display,
  subtitle: Typography.subtitle,
  screenTitle: Typography.screenTitle,
  sheetTitle: Typography.sheetTitle,
  section: Typography.section,
  menu: Typography.menu,
  label: Typography.label,
  supporting: Typography.supporting,
  caption: Typography.caption,
  micro: Typography.micro,
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

import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { hasAdLabel } from '@/lib/hashtags';

export function PostAdLabel({ hashtags }: { hashtags?: readonly string[] }) {
  const { tr, locale } = useLanguage(), theme = useTheme();
  if (!hasAdLabel(hashtags)) return null;
  return <ThemedText type="smallBold" accessibilityLanguage={locale} accessibilityLabel={tr('광고')} style={{ color: theme.textSecondary, borderColor: theme.line, borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, fontSize: 11, lineHeight: 16, alignSelf: 'flex-start' }}>AD</ThemedText>;
}

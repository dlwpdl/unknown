import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlMetrics, ControlMotion, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { meetupPartnerLine } from '@/lib/meetup-partner';
import type { RoomPreview } from '@/lib/types';

/** Admin-set partner perk on a meetup; opens the partner's business profile. Renders nothing when unset. */
export function MeetupPartnerLine({ partner, onBeforeNavigate, style }: {
  partner: RoomPreview['partner']; onBeforeNavigate?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { play } = useInteractionFeedback();
  const line = meetupPartnerLine(partner, tr);
  if (!line || !partner) return null;
  return <Pressable analyticsId="meetup.partner.open" accessibilityRole="link" accessibilityLabel={line}
    accessibilityHint={tr('{0} 비즈니스 프로필 보기', partner.name)}
    onPress={() => { play('selection'); onBeforeNavigate?.(); router.push({ pathname: '/company/[id]', params: { id: partner.businessId } }); }}
    style={({ pressed }) => [styles.row, style, pressed && styles.pressed]}>
    <SymbolView name={{ ios: 'gift', android: 'redeem', web: 'redeem' }} size={IconSize.inline} tintColor={theme.accent} />
    <ThemedText style={[Typography.supporting, styles.text]} themeColor="accent">{line}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: ControlMetrics.touch, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  text: { flex: 1, minWidth: 0 },
  pressed: { opacity: ControlMotion.pressedOpacity },
});

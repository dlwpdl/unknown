import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import type { DailyQuota } from '@/lib/types';

// 일력 칩 — "오늘"의 물성. Intl 의존 없이 수동 포맷 (Hermes 로케일 편차 회피)
function todayLabel() {
  const now = new Date();
  const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 ${day}요일`;
}

export function DailyChip({ quota }: { quota: DailyQuota }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <ThemedText type="smallBold">{todayLabel()}</ThemedText>
      <ThemedText type="smallBold" style={{ color: theme.accent, fontVariant: ['tabular-nums'] }}>
        {t.feed.remaining(quota.used, quota.max)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
});

import { useMemo } from 'react';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';
// shortcut: toqr is locked through Expo CLI (same import as the public web pages); recheck when upgrading Expo.
import { toQR } from 'toqr';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { InviteReward } from '@/lib/invites';

/** The system share sheet on phones; the browser's share or clipboard on the web. */
export function useInviteShare() {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  return async (message: string, url: string) => {
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ text: message, url });
        else { await navigator.clipboard.writeText(url); window.alert(tr('초대 링크를 복사했어요.')); }
      } else await Share.share({ message: `${message}\n${url}` });
      play('success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      play('warning');
      Alert.alert(tr('공유할 수 없어요'), tr('잠시 후 다시 시도해 주세요.'));
    }
  };
}

export function InviteStats({ items }: { items: [string, number][] }) {
  const theme = useTheme();
  return <View style={styles.stats}>
    {items.map(([label, value]) => <View key={label} accessible accessibilityLabel={`${label} ${value}`} style={[styles.stat, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold" style={styles.statValue}>{value}</ThemedText>
    </View>)}
  </View>;
}

export function rewardName(reward: InviteReward, business: boolean, tr: (text: string, ...values: unknown[]) => string) {
  const full = reward.days === 14;
  if (business) return full ? tr('비즈니스 2주 이용권') : tr('비즈니스 {0}일 이용권', reward.days);
  if (reward.tier === 'pro') return full ? tr('프로 2주 이용권') : tr('프로 {0}일 이용권', reward.days);
  return full ? tr('플러스 2주 이용권') : tr('플러스 {0}일 이용권', reward.days);
}

/** QR drawn with plain views (no SVG dependency in the app): one strip per run of dark cells. */
export function InviteQr({ url, size = 168 }: { url: string; size?: number }) {
  const { tr } = useLanguage();
  const rows = useMemo(() => {
    try {
      const cells = [...toQR(url)], width = Math.sqrt(cells.length);
      if (!Number.isInteger(width)) return null;
      return Array.from({ length: width }, (_, y) => {
        const runs: [number, number][] = [];
        for (let x = 0; x < width; x++) if (cells[y * width + x]) {
          if (runs.length && runs[runs.length - 1][0] + runs[runs.length - 1][1] === x) runs[runs.length - 1][1]++;
          else runs.push([x, 1]);
        }
        return runs;
      });
    } catch { return null; }
  }, [url]);
  if (!rows) return null;
  const cell = size / (rows.length + 8);
  return <View accessible accessibilityRole="image" accessibilityLabel={tr('초대 링크 QR 코드')} style={[styles.qr, { width: size, height: size, padding: cell * 4 }]}>
    {rows.map((runs, y) => <View key={y} style={{ height: cell }}>
      {runs.map(([x, length]) => <View key={x} style={{ position: 'absolute', left: x * cell, width: length * cell, height: cell, backgroundColor: '#000' }} />)}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderRadius: 12, padding: 10, gap: 2 },
  statValue: { fontSize: 16, lineHeight: 22 },
  // QR codes stay black on white in both themes so phone cameras read them.
  qr: { backgroundColor: '#fff', borderRadius: 12, alignSelf: 'center' },
});

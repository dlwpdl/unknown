import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { CITIES } from '@/lib/mock';

export function NearbyCityCard({ onSelect, onChooseCity, onFix, settings = false }: {
  onSelect?: (id: string) => void;
  onChooseCity?: () => void;
  onFix?: (fix: (LocationFix & { userId: string }) | null) => void;
  settings?: boolean;
}) {
  const theme = useTheme();
  const location = useCommunityLocation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const recommended = CITIES.find((city) => city.id === location.cityId);
  const disabled = location.busy || !location.ready;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.heading}>
      <SymbolView name={{ ios: 'location', android: 'near_me', web: 'near_me' }} size={24} tintColor={theme.accent} />
      <View style={styles.copy}>
        <ThemedText style={styles.title}>내 주변 소식</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">GPS로 가까운 도시와 주변 동네를 찾아요.</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="위치 이용 안내" accessibilityState={{ expanded: detailsOpen }} aria-expanded={detailsOpen}
        onPress={() => setDetailsOpen(value => !value)} style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}>
        <SymbolView name={{ ios: detailsOpen ? 'chevron.up' : 'info.circle', android: detailsOpen ? 'expand_less' : 'info', web: detailsOpen ? 'expand_less' : 'info' }} size={20} tintColor={theme.textSecondary} />
      </Pressable>
    </View>
    {detailsOpen && <View style={[styles.details, { borderColor: theme.line }]}>
      <ThemedText type="small" themeColor="textSecondary">직접 선택해 저장한 선호 지역이 우선 적용돼요. 위치 공유에 동의하지 않아도 도시를 직접 고를 수 있어요.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">동의하면 로그인과 글·모임 작성 때만 위치를 한 번 확인해요. 다른 회원에게는 선택한 도시만 공개돼요.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">좌표·정확도·측정 시각은 안전 운영을 위해 30일 보관하며 권한 있는 관리자만 조회해요. 설정에서 공유를 끄고 기록을 삭제할 수 있어요.</ThemedText>
    </View>}
    {!!location.message && <ThemedText type="small" accessibilityLiveRegion="polite">{location.message}</ThemedText>}
    {recommended && onSelect && <Pressable accessibilityRole="button" onPress={() => onSelect(recommended.id)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{recommended.name} 소식 보기</ThemedText>
    </Pressable>}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled, busy: location.busy }}
        onPress={() => {
          if (!location.enabled && !detailsOpen) { setDetailsOpen(true); return; }
          void location.capture(true).then((fix) => { if (active.current) onFix?.(fix); });
        }}
        style={({ pressed }) => [styles.primary, { backgroundColor: theme.backgroundElement, opacity: disabled ? 0.5 : 1 }, pressed && styles.pressed]}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>{location.busy ? '위치 확인 중…' : location.enabled ? '위치 다시 확인' : detailsOpen ? '동의하고 찾기' : '내 위치로 찾기'}</ThemedText>
      </Pressable>
      {onChooseCity && <Pressable accessibilityRole="button" onPress={onChooseCity} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <ThemedText type="smallBold" themeColor="textSecondary">직접 선택</ThemedText>
      </Pressable>}
    </View>
    {settings && location.enabled && <Pressable accessibilityRole="button" disabled={location.busy} onPress={() => void location.disable()} style={styles.button}>
      <ThemedText type="smallBold">위치 공유 끄고 기록 삭제</ThemedText>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: Spacing.three, gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  copy: { flex: 1, gap: Spacing.one }, title: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  disclosure: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three },
  primary: { minHeight: 44, borderRadius: 8, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, justifyContent: 'center' },
  button: { minHeight: 44, justifyContent: 'center' }, pressed: { opacity: 0.65 },
});

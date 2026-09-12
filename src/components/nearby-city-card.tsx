import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { type LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { CITIES } from '@/lib/mock';

export function NearbyCityCard({ onSelect, onFix, settings = false }: {
  onSelect?: (id: string) => void;
  onFix?: (fix: (LocationFix & { userId: string }) | null) => void;
  settings?: boolean;
}) {
  const theme = useTheme();
  const location = useCommunityLocation();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const recommended = CITIES.find((city) => city.id === location.cityId);
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">내 도시에서 시작하기</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">위치 공유에 동의하면 로그인과 글·모임 작성 때만 위치를 한 번 확인해요. 공개되는 정보는 선택한 도시뿐이에요.</ThemedText>
    {!location.enabled && <ThemedText type="small" themeColor="textSecondary">좌표·정확도·측정 시각은 안전 운영을 위해 30일 보관하며 권한 있는 관리자만 조회해요. 설정에서 공유를 끄고 삭제할 수 있어요. 동의 없이 도시를 직접 골라도 돼요.</ThemedText>}
    {!!location.message && <ThemedText type="small" accessibilityLiveRegion="polite">{location.message}</ThemedText>}
    {recommended && onSelect && <Pressable accessibilityRole="button" onPress={() => onSelect(recommended.id)} style={styles.button}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{recommended.name} 커뮤니티 추천 · 선택</ThemedText>
    </Pressable>}
    <Pressable accessibilityRole="button" disabled={location.busy || !location.ready} accessibilityState={{ disabled: location.busy || !location.ready, busy: location.busy }}
      onPress={() => void location.capture(true).then((fix) => { if (active.current) onFix?.(fix); })}
      style={[styles.button, { opacity: location.busy ? 0.5 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{location.busy ? '위치 확인 중…' : location.enabled ? '내 위치로 다시 추천' : '동의하고 내 위치로 추천'}</ThemedText>
    </Pressable>
    {settings && location.enabled && <Pressable accessibilityRole="button" disabled={location.busy} onPress={() => void location.disable()} style={styles.button}>
      <ThemedText type="smallBold">위치 공유 끄고 기록 삭제</ThemedText>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 16, gap: 8, borderWidth: 1, borderRadius: 12 }, button: { minHeight: 44, justifyContent: 'center' } });

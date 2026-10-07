import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from '@/components/analytics-controls';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { Spacing } from '@/constants/theme';
import { eventNotice, eventPriceLabel, eventTime, isFestivalEvent, loadTicketmasterEvent, type TicketmasterEvent } from '@/lib/ticketmaster';
import { ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster';

export function TicketmasterSourceLink({ body, cityId, onNavigate }: { body: string; cityId: string; onNavigate: () => void }) {
  const router = useRouter(), theme = useTheme();
  const { play } = useInteractionFeedback();
  const id = ticketmasterReference(body);
  const key = `${cityId}:${id ?? ''}`;
  const [result, setResult] = useState<{ key: string; event: TicketmasterEvent | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    loadTicketmasterEvent(cityId, id)
      .then(({ event }) => { if (active) setResult({ key, event, error: false }); })
      .catch(() => { if (active) setResult({ key, event: null, error: true }); });
    return () => { active = false; };
  }, [cityId, id, key]);
  if (!id) return null;
  const current = result?.key === key ? result : null;
  const event = current?.event;
  const notice = event ? eventNotice(event) : '';
  return <View style={styles.section} accessibilityRole="summary">
    <ThemedText type="smallBold" themeColor="accent">{event && isFestivalEvent(event) ? '함께 갈 페스티벌' : '함께 갈 행사'}</ThemedText>
    {event ? <>
      <ThemedText type="smallBold">{event.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{eventTime(event)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{[event.venue, event.city].filter(Boolean).join(' · ') || '장소 확인 필요'}</ThemedText>
      {event.price && <ThemedText type="small" themeColor="textSecondary">{eventPriceLabel(event)}</ThemedText>}
      {!!notice && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{notice}</ThemedText>}
    </> : <ThemedText type="small" themeColor="textSecondary">{current?.error ? '행사 정보를 불러오지 못했어요.' : '행사 정보를 불러오는 중…'}</ThemedText>}
    <Pressable analyticsId="ticketmaster.meetup.source" accessibilityRole="link" accessibilityLabel="행사 상세 보기" onPress={() => { play('selection'); onNavigate(); router.push({ pathname: '/events/[id]', params: { id, cityId } }); }} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>행사 상세 보기 ›</ThemedText>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.three, gap: Spacing.one },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});

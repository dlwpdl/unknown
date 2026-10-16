import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from '@/components/analytics-controls';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { Spacing } from '@/constants/theme';
import { eventNotice, eventPriceLabel, eventTime, isFestivalEvent, loadTicketmasterEvent, type TicketmasterEvent } from '@/lib/ticketmaster';
import { safeTicketUrl, ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster';

export function TicketmasterSourceLink({ body, cityId, onNavigate }: { body: string; cityId: string; onNavigate: () => void }) {
  const { tr, locale: appLocale } = useLanguage();
  const router = useRouter(), theme = useTheme();
  const { play } = useInteractionFeedback();
  const id = ticketmasterReference(body);
  const key = `${cityId}:${id ?? ''}`;
  const [result, setResult] = useState<{ key: string; event: TicketmasterEvent | null; error: boolean } | null>(null);
  const [failedLink, setFailedLink] = useState('');
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
  const ticketUrl = safeTicketUrl(event?.ticketUrl);
  const notice = event ? eventNotice(event, appLocale) : '';
  return <View style={styles.section} accessibilityRole="summary">
    <ThemedText type="smallBold" themeColor="accent">{event && isFestivalEvent(event) ? tr("함께 갈 페스티벌") : tr("함께 갈 행사")}</ThemedText>
    {event ? <>
      <ThemedText type="smallBold">{event.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{eventTime(event, appLocale)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{[event.venue, event.city].filter(Boolean).join(' · ') || tr("장소 확인 필요")}</ThemedText>
      {event.price && <ThemedText type="small" themeColor="textSecondary">{eventPriceLabel(event, appLocale)}</ThemedText>}
      {!!notice && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{notice}</ThemedText>}
    </> : <ThemedText type="small" themeColor="textSecondary">{current?.error ? tr("행사 정보를 불러오지 못했어요.") : tr("행사 정보를 불러오는 중…")}</ThemedText>}
    {(Platform.OS !== 'web' || ticketUrl) && <Pressable analyticsId="ticketmaster.meetup.source" accessibilityRole="link" accessibilityLabel={Platform.OS === 'web' ? tr("Ticketmaster에서 행사 확인") : tr("행사 상세 보기")} onPress={() => {
      play('selection');
      if (Platform.OS === 'web') { setFailedLink(''); if (ticketUrl) void Linking.openURL(ticketUrl).catch(() => setFailedLink(key)); }
      else { onNavigate(); router.push({ pathname: '/events/[id]', params: { id, cityId } }); }
    }} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{Platform.OS === 'web' ? tr("Ticketmaster에서 행사 확인 ↗") : tr("행사 상세 보기 ›")}</ThemedText>
    </Pressable>}
    {failedLink === key && <ThemedText type="small" accessibilityRole="alert">{tr("행사 페이지를 열지 못했어요. 다시 눌러주세요.")}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.three, gap: Spacing.one },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});

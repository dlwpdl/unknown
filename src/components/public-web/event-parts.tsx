import { Image } from 'expo-image';
import Head from 'expo-router/head';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ListLoading } from '@/components/list-card';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { businessMediaUrl } from '@/lib/business-media';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { EVENT_COPY, type EventLanguage } from './event-copy';

const wordmark = require('../../../assets/brand/gling-night-wordmark.png');
const LOGO = 46;

/** English first, Korean on tap. The form's language field uses the same chips, so both stay in step. */
export function LanguageChips({ language, onLanguage, label, analyticsId }: {
  language: EventLanguage; onLanguage: (language: EventLanguage) => void; label: string; analyticsId: string;
}) {
  const { play } = useInteractionFeedback();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
    {(['en', 'ko'] as const).map(value => <SelectionChip key={value} analyticsId={`${analyticsId}.${value}`} label={EVENT_COPY[value].languageName}
      selected={language === value} accessibilityRole="radio" accessibilityState={{ checked: language === value }}
      onPress={() => { if (language === value) return; play('selection'); onLanguage(value); }} />)}
  </View>;
}

/** Shell shared by the apply and business pages: language switch, scrolling body, official address last. */
export function EventPage({ language, onLanguage, title, children }: {
  language: EventLanguage; onLanguage: (language: EventLanguage) => void; title: string; children: ReactNode;
}) {
  const copy = EVENT_COPY[language];
  return <div lang={language} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <Head><title>{title}</title><meta name="robots" content="noindex, nofollow" /></Head>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.top}><LanguageChips language={language} onLanguage={onLanguage} label={copy.l_lang} analyticsId="event.language" /></View>
      {children}
      <ThemedText themeColor="textSecondary" style={Typography.caption}>{copy.foot}</ThemedText>
    </ScrollView>
  </div>;
}

/** The warm band of the approved apply-page example (owner 2026-11-02 "머리 모양 시안처럼 고치고 켜기"). Its colours are fixed,
 * so it reads the same in light and dark; docs/design-system.md lists it as a web-only exception. */
const BAND = { background: 'radial-gradient(120% 90% at 20% 10%, #7a2e1c 0%, #3a1209 55%, #140604 100%)', title: '#ffffff', host: '#ead9cc',
  times: '#e9d6c8', badge: '#f3e6d6', ring: 'rgba(255, 255, 255, 0.7)' };

/** Gling wordmark × the business's real logo (owner 2026-11-02 "항상 로고로해야지 맞는듯": never a letter badge), who runs it, the title.
 * The hosted-by line names the business's Instagram handle when the campaign has one, else the business. */
export function EventHeader({ language, title, business, avatar, instagram }: {
  language: EventLanguage; title: string; business: string; avatar: string | null; instagram?: string | null;
}) {
  const logo = avatar ? businessMediaUrl(avatar) : null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: Spacing.two, borderRadius: 20, background: BAND.background,
    padding: `${Spacing.four}px ${Spacing.three}px ${Spacing.three}px` }}>
    <View accessible accessibilityRole="image" accessibilityLabel={logo ? `Gling × ${business}` : 'Gling'} style={styles.lockup}>
      <Image source={wordmark} style={styles.wordmark} contentFit="contain" accessible={false} />
      {logo && <>
        <ThemedText style={[Typography.menu, { color: BAND.times }]}>×</ThemedText>
        <Image source={{ uri: logo }} contentFit="cover" accessible={false} style={[styles.logo, { borderColor: BAND.ring, backgroundColor: BAND.badge }]} />
      </>}
    </View>
    <ThemedText style={[Typography.supporting, { color: BAND.host }]}>{EVENT_COPY[language].host(instagram ? `@${instagram}` : business)}</ThemedText>
    <ThemedText accessibilityRole="header" style={[Typography.sheetTitle, { color: BAND.title }]}>{title}</ThemedText>
  </div>;
}

/** One line of event facts, the emoji marking what it is (as in the approved example). */
export function EventFact({ mark, children }: { mark: string; children: ReactNode }) {
  return <View style={styles.fact}>
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mark}><ThemedText>{mark}</ThemedText></View>
    <View style={styles.factBody}>{children}</View>
  </View>;
}

/** A dropdown for visit dates and times. The page is web-only, so it is the browser's own select: compact for long date lists,
 * native on phones and fully keyboard and screen-reader accessible. Styled like ControlStyles.field. */
export function EventSelect({ label, placeholder, value, options, onChange, disabled, grow = 1 }: {
  label: string; placeholder: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean; grow?: number;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <select aria-label={label} value={value} disabled={disabled} onChange={event => { play('selection'); onChange(event.target.value); }}
    style={{ flex: grow, minWidth: 0, minHeight: ControlMetrics.field, borderRadius: ControlMetrics.radius.field, border: `1px solid ${theme.line}`,
      background: theme.card, color: value ? theme.text : theme.textSecondary, font: 'inherit', fontSize: 15, padding: '0 8px', colorScheme: 'dark',
      opacity: disabled ? 0.45 : 1 }}>
    <option value="">{placeholder}</option>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

/** Loading, expired (one line) or a retryable load failure. */
export function EventLoadState({ language, state, onRetry }: { language: EventLanguage; state: 'loading' | 'expired' | 'failed'; onRetry: () => void }) {
  const copy = EVENT_COPY[language];
  if (state === 'loading') return <ListLoading label={copy.loading} />;
  if (state === 'expired') return <ThemedText accessibilityRole="header" style={[Typography.section, styles.center]}>{copy.expired}</ThemedText>;
  return <StateCard kind="error" title={copy.loadFailed} body={copy.loadFailedBody} actionLabel={copy.retry} onAction={onRetry} analyticsId="event.retry" />;
}

export const eventStyles = StyleSheet.create({
  section: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  handle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  input: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 0 },
});

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four },
  top: { alignItems: 'flex-end' },
  chips: { flexDirection: 'row', gap: Spacing.two },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.two },
  wordmark: { width: 72, height: 30 },
  logo: { width: LOGO, height: LOGO, borderRadius: LOGO / 2, borderWidth: 2 },
  fact: { flexDirection: 'row', gap: Spacing.two },
  mark: { width: 24, alignItems: 'center' },
  factBody: { flex: 1, gap: 2 },
  center: { textAlign: 'center' },
});

import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ListCard, ListRow, SectionLabel } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { callEventLink } from '@/lib/event-links';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { EVENT_COPY, eventDay, eventHandle, eventVisit, type EventLanguage, type EventLookupStatus } from './event-copy';
import { EventFact, EventHeader, EventLoadState, EventPage, eventStyles } from './event-parts';

type StoreView = {
  title: string; business: string; avatar: string | null; ends_on: string | null; deadline_note: string | null; timezone: string; applicant_count: number;
  winners: { handle: string | null; name: string; scheduled_at: string | null; party_size: number | null; has_allergies: boolean | null; allergies: string | null }[];
  benefits: { title: string; discount_percent: number | null; expires_on: string | null; terms: string | null }[];
};

// gling.ej-entertainment.com/partner#<token>, the business's private page: who won, when they come, how many and their allergies. The token sits in the fragment,
// so it never reaches a server log, a Referer header or analytics; only its hash is stored.
export default function EventPartnerPage() {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [language, setLanguage] = useState<EventLanguage>('en');
  const [load, setLoad] = useState<'loading' | 'expired' | 'failed'>('loading');
  const [view, setView] = useState<StoreView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  // A check that finds someone is recorded as one use (owner 2026-11-02 "가게 링크 버튼으로 세기"); staff can undo a wrong one.
  const [result, setResult] = useState<{ handle: string; status: EventLookupStatus; useId?: string; uses?: number; mealUsed?: boolean; undone?: boolean } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState<'badHandle' | 'sendFailed' | 'undoFailed' | null>(null);
  const copy = EVENT_COPY[language];

  useEffect(() => {
    let live = true;
    const token = window.location.hash.slice(1);
    const request = token ? callEventLink<{ view: StoreView }>({ store: token }) : Promise.resolve({ status: 404, data: null });
    void request.then(({ status, data }) => {
      if (!live) return;
      if (status === 200 && data?.view) setView(data.view);
      else setLoad(status === 404 || status === 400 ? 'expired' : 'failed');
    });
    return () => { live = false; };
  }, [attempt]);

  const check = async () => {
    const token = window.location.hash.slice(1);
    if (busy || !token) return;
    const checked = eventHandle(handle);
    if (!checked) { play('warning'); setResult(null); setNotice('badHandle'); return; }
    setBusy(true); setNotice(null);
    const { status, data } = await callEventLink<{ status: EventLookupStatus; use_id?: string; uses?: number; meal_used?: boolean }>({ store: token, handle: checked });
    setBusy(false);
    if (status === 200 && data?.status) {
      play(data.status === 'none' || data.meal_used ? 'warning' : 'success');
      setResult({ handle: checked, status: data.status, useId: data.use_id, uses: data.uses, mealUsed: data.meal_used });
      return;
    }
    play('warning');
    if (status === 404) { setView(null); setLoad('expired'); } else setNotice('sendFailed');
  };

  const undo = async () => {
    const token = window.location.hash.slice(1);
    if (undoing || !token || !result?.useId) return;
    setUndoing(true); setNotice(null);
    const { status, data } = await callEventLink<{ undone: boolean }>({ store: token, undo: result.useId });
    setUndoing(false);
    if (status === 200 && data) {
      play(data.undone ? 'success' : 'warning');
      if (data.undone) setResult(value => value && { ...value, undone: true }); else setNotice('undoFailed');
      return;
    }
    play('warning');
    if (status === 404) { setView(null); setLoad('expired'); } else setNotice('sendFailed');
  };

  return <EventPage language={language} onLanguage={setLanguage} title={view ? `${view.title} · Gling` : 'Gling'}>
    {!view ? <EventLoadState language={language} state={load} onRetry={() => { setLoad('loading'); setAttempt(value => value + 1); }} /> : <>
      <EventHeader language={language} title={view.title} business={view.business} avatar={view.avatar} />
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{copy.partnerPrivate}</ThemedText>

      <View style={eventStyles.section}>
        <SectionLabel>{copy.check}</SectionLabel>
        <ThemedText themeColor="textSecondary" style={Typography.supporting}>{copy.checkHint}</ThemedText>
        <View style={[ControlStyles.field, eventStyles.handle, { borderColor: theme.line, backgroundColor: theme.card }]}>
          <ThemedText themeColor="textSecondary" style={Typography.menu}>@</ThemedText>
          <TextInput accessibilityLabel={copy.l_handle} value={handle} onChangeText={value => { setHandle(value); setResult(null); setNotice(null); }}
            onFocus={() => play('selection')} onSubmitEditing={() => void check()} placeholder={copy.handle_ph} placeholderTextColor={theme.textSecondary}
            autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} maxLength={31} returnKeyType="search" editable={!busy}
            style={[eventStyles.input, Typography.menu, { color: theme.text }]} />
        </View>
        <RaisedActionButton analyticsId="event.partner.check" tone="secondary" label={copy.checkButton} busy={busy} disabled={!handle.trim()} onPress={() => void check()} />
        {result && <View accessibilityLiveRegion="polite" style={eventStyles.section}><ListCard>
          <ListRow title={copy.result[result.status](result.handle)}
            detail={result.useId ? result.undone ? copy.useUndone : copy.useLogged(result.uses ?? 1) : undefined}
            trailing={result.useId && !result.undone ? <RaisedActionButton analyticsId="event.partner.undo" compact tone="secondary" label={copy.undo}
              busy={undoing} onPress={() => void undo()} /> : undefined} />
        </ListCard>
        {result.mealUsed && !result.undone && <ThemedText style={[Typography.supporting, { color: theme.danger }]}>{copy.mealUsed}</ThemedText>}
        </View>}
        {notice && <ThemedText accessibilityLiveRegion="polite" style={[Typography.supporting, { color: theme.danger }]}>{copy[notice]}</ThemedText>}
      </View>

      <View style={eventStyles.section}>
        <SectionLabel>{copy.winners}</SectionLabel>
        {view.winners.length ? <ListCard>
          {view.winners.map((winner, index) => <ListRow key={`${winner.handle ?? winner.name}-${index}`} title={winner.handle ? `@${winner.handle}` : winner.name}
            detail={[winner.scheduled_at ? eventVisit(winner.scheduled_at, view.timezone, language) : copy.noVisit,
              winner.party_size ? copy.party(winner.party_size) : '',
              winner.has_allergies ? copy.allergies(winner.allergies ?? '') : winner.has_allergies === false ? copy.noAllergies : ''].filter(Boolean).join(' · ')} />)}
        </ListCard> : <ThemedText themeColor="textSecondary" style={Typography.body}>{copy.noWinners}</ThemedText>}
        <ThemedText themeColor="textSecondary" style={Typography.supporting}>{copy.applicants(view.applicant_count)}</ThemedText>
      </View>

      {view.benefits.length > 0 && <View style={eventStyles.section}>
        <SectionLabel>{copy.discount}</SectionLabel>
        {view.benefits.map((benefit, index) => <EventFact key={`${benefit.title}-${index}`} mark="🎁">
          <ThemedText style={Typography.body}>{benefit.title}</ThemedText>
          {!!(benefit.discount_percent || benefit.expires_on) && <ThemedText themeColor="textSecondary" style={Typography.supporting}>
            {copy.discountDetail(benefit.discount_percent, benefit.expires_on ? eventDay(benefit.expires_on, language) : null)}</ThemedText>}
          {!!benefit.terms && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{benefit.terms}</ThemedText>}
        </EventFact>)}
      </View>}

      {!!view.ends_on && <EventFact mark="📅">
        <ThemedText style={Typography.body}>{copy.runsUntil(eventDay(view.ends_on, language))}</ThemedText>
        {!!view.deadline_note && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{view.deadline_note}</ThemedText>}
      </EventFact>}
    </>}
  </EventPage>;
}

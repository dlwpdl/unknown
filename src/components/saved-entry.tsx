import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadSavedItemState, setSavedItem, type SavedState, type SavedTarget } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

type Operation = { key: string; visibility: ReturnType<typeof useContentVisibility>; active: boolean; busy: boolean };

export function useSavedEntry(target: SavedTarget | null, visible: boolean) {
  const { isAuthed, isAuthLoading, me, promptLogin } = useAuth();
  const { language } = useLanguage(), { play } = useInteractionFeedback();
  const hidden = useContentVisibility(), focused = useIsFocused();
  const { kind, id, cityId } = target ?? {};
  const [retry, setRetry] = useState(0);
  const key = `${isAuthLoading ? 'loading' : isAuthed ? me.id : 'guest'}:${kind}:${cityId}:${id}:${retry}`;
  const enabled = !!kind && !!id && visible && focused && !isAuthLoading && !(kind === 'user' && hidden('user', id));
  const operation = useRef<Operation | null>(null);
  const [result, setResult] = useState<{ operation: Operation; state: SavedState | null; error: '' | 'read' | 'write'; saving: boolean } | null>(null);
  useLayoutEffect(() => {
    const next = { key, visibility: hidden, active: enabled, busy: false };
    operation.current = next;
    return () => { next.active = false; };
  }, [key, hidden, enabled]);
  useEffect(() => {
    const current = operation.current;
    if (!enabled || !isAuthed || !kind || !id || !current) return;
    current.busy = true;
    setResult({ operation: current, state: null, error: '', saving: false });
    void loadSavedItemState(supabase, { kind, id, ...(cityId ? { cityId } : {}) }).then(state => {
      if (current.active && operation.current === current) setResult({ operation: current, state, error: '', saving: false });
    }).catch(() => {
      if (current.active && operation.current === current) setResult({ operation: current, state: null, error: 'read', saving: false });
    }).finally(() => { current.busy = false; });
  }, [key, hidden, enabled, isAuthed, kind, id, cityId]);
  const current = enabled && result?.operation.key === key && result.operation.visibility === hidden ? result : null;
  function onPress() {
    const request = operation.current;
    if (!enabled || !kind || !id || !request?.active || request.key !== key || request.visibility !== hidden || request.busy) return;
    if (current && current.operation !== request) return;
    play('selection');
    if (!isAuthed) return promptLogin(language === 'ko' ? '저장하려면 로그인해 주세요.' : 'Sign in to save this item.');
    if (!current?.state) { setRetry(value => value + 1); return; }
    if (!current.state.available && !current.state.saved) return;
    request.busy = true;
    setResult({ ...current, saving: true, error: '' });
    // Keep the raw place reference so the server can resolve links added since the read.
    void setSavedItem(supabase, { kind, id, ...(cityId ? { cityId } : {}) }, !current.state.saved).then(state => {
      if (!request.active || operation.current !== request) return;
      setResult({ operation: request, state, error: '', saving: false }); play('success');
    }).catch(() => {
      if (!request.active || operation.current !== request) return;
      setResult({ ...current, saving: false, error: 'write' }); play('warning');
    }).finally(() => { request.busy = false; });
  }
  const error = !current?.error ? '' : current.error === 'read'
    ? language === 'ko' ? '저장 상태를 확인하지 못했어요. 다시 시도해주세요.' : 'Couldn’t check if this is saved. Try again.'
    : language === 'ko' ? '저장 상태를 바꾸지 못했어요. 다시 시도해주세요.' : 'Couldn’t update your saved items. Try again.';
  return { state: current?.state ?? null, error,
    loading: enabled && isAuthed && !current?.state && !current?.error,
    busy: current?.saving ?? false, visible: enabled, onPress };
}

export function SavedEntryButton({ entry, kind, analyticsId }: { entry: ReturnType<typeof useSavedEntry>; kind: 'place' | 'user'; analyticsId: 'save.place' | 'save.user' }) {
  const theme = useTheme(), { language } = useLanguage(), ko = language === 'ko';
  if (!entry.visible || entry.state && !entry.state.available && !entry.state.saved) return null;
  const saved = entry.state?.saved ?? false, retry = !entry.state && !!entry.error, busy = entry.loading || entry.busy;
  const label = busy ? ko ? '저장 상태 확인 중' : 'Checking saved status' : retry ? ko ? '저장 상태 다시 확인' : 'Check saved status again'
    : kind === 'place' ? saved ? ko ? '장소 저장 취소' : 'Unsave place' : ko ? '장소 저장' : 'Save place'
      : saved ? ko ? '사용자 저장 취소' : 'Unsave person' : ko ? '사용자 저장' : 'Save person';
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected: saved, busy, disabled: busy }} disabled={busy} onPress={entry.onPress}
    style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', selected: saved, pressed, busy }).container]}>
    {busy ? <GlingLoader size={14} accessibilityLabel={label} /> : <SymbolView name={retry
      ? { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }
      : { ios: saved ? 'bookmark.fill' : 'bookmark', android: saved ? 'bookmark' : 'bookmark_border', web: saved ? 'bookmark' : 'bookmark_border' }} size={IconSize.toolbar} tintColor={theme.accent} />}
  </Pressable>;
}

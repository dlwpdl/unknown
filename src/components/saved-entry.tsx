import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadSavedItemState, loadSavedPlaceState, setSavedItem, setSavedPlaceState, type SavedPlaceStatus, type SavedState, type SavedTarget } from '@/lib/saved-items';
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
    void (kind === 'place' || kind === 'merchant' ? loadSavedPlaceState : loadSavedItemState)(supabase, { kind, id, ...(cityId ? { cityId } : {}) }).then(state => {
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
  // G1: save as 가 보고 싶음/가 봤음 or unsave (null). Resolves true once the server confirmed it.
  async function choose(status: SavedPlaceStatus | null) {
    const request = operation.current;
    if (!enabled || !kind || !id || !request?.active || request.key !== key || request.visibility !== hidden || request.busy || !current?.state || current.operation !== request) return false;
    if (status !== null && !current.state.available && !current.state.saved) return false;
    request.busy = true;
    setResult({ ...current, saving: true, error: '' });
    try {
      const state = await setSavedPlaceState(supabase, { kind, id, ...(cityId ? { cityId } : {}) }, status);
      if (!request.active || operation.current !== request) return false;
      setResult({ operation: request, state, error: '', saving: false }); play('success');
      return true;
    } catch {
      if (request.active && operation.current === request) { setResult({ ...current, saving: false, error: 'write' }); play('warning'); }
      return false;
    } finally { request.busy = false; }
  }
  const error = !current?.error ? '' : current.error === 'read'
    ? language === 'ko' ? '저장 상태를 확인하지 못했어요. 다시 시도해주세요.' : 'Couldn’t check if this is saved. Try again.'
    : language === 'ko' ? '저장 상태를 바꾸지 못했어요. 다시 시도해주세요.' : 'Couldn’t update your saved items. Try again.';
  return { state: current?.state ?? null, error,
    loading: enabled && isAuthed && !current?.state && !current?.error,
    busy: current?.saving ?? false, visible: enabled, onPress, choose };
}

export function SavedEntryButton({ entry, kind, analyticsId, onBeen }: { entry: ReturnType<typeof useSavedEntry>; kind: 'place' | 'user'; analyticsId: 'save.place' | 'save.user' | 'company.save'; onBeen?: () => void }) {
  const theme = useTheme(), { language } = useLanguage(), ko = language === 'ko', { play } = useInteractionFeedback();
  const [menu, setMenu] = useState(false);
  if (!entry.visible || entry.state && !entry.state.available && !entry.state.saved) return null;
  const saved = entry.state?.saved ?? false, retry = !entry.state && !!entry.error, busy = entry.loading || entry.busy;
  const status = entry.state?.status, been = status === 'been';
  const label = busy ? ko ? '저장 상태 확인 중' : 'Checking saved status' : retry ? ko ? '저장 상태 다시 확인' : 'Check saved status again'
    : kind === 'place' ? status !== undefined ? saved ? been ? ko ? '가 봤어요로 저장됨 · 바꾸기' : 'Saved as been · change' : ko ? '가 보고 싶어요로 저장됨 · 바꾸기' : 'Saved as want to go · change' : ko ? '장소 저장' : 'Save place'
      : saved ? ko ? '장소 저장 취소' : 'Unsave place' : ko ? '장소 저장' : 'Save place'
      : saved ? ko ? '프로필 저장 취소' : 'Unsave profile' : ko ? '프로필 저장' : 'Save profile';
  // A server with save kinds opens the 가 보고 싶음/가 봤음 choice; an older one keeps the one-tap toggle.
  const choice = kind === 'place' && status !== undefined;
  return <>
    <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: saved, busy, disabled: busy }} disabled={busy} onPress={choice ? () => { play('selection'); setMenu(true); } : entry.onPress}
      style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', selected: saved, pressed, busy }).container]}>
      {busy ? <GlingLoader size={14} accessibilityLabel={label} /> : <SymbolView name={retry
        ? { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }
        : been ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
        : { ios: saved ? 'bookmark.fill' : 'bookmark', android: saved ? 'bookmark' : 'bookmark_border', web: saved ? 'bookmark' : 'bookmark_border' }} size={IconSize.toolbar} tintColor={theme.accent} />}
    </Pressable>
    {menu && <MeetupManageSheet visible title={ko ? '이 장소 저장' : 'Save this place'} onClose={() => setMenu(false)} actions={[
      { key: 'want', analyticsId: 'save.place.want', label: ko ? '가 보고 싶어요' : 'Want to go', hint: status === 'want' ? ko ? '지금 이걸로 저장돼 있어요' : 'Saved this way now' : ko ? '나중에 가 볼 곳에 넣어 둬요' : 'Keep it for later',
        icon: { ios: 'bookmark', android: 'bookmark_border', web: 'bookmark_border' }, onPress: () => { void entry.choose('want'); } },
      { key: 'been', analyticsId: 'save.place.been', label: ko ? '가 봤어요' : 'Been here', hint: been ? ko ? '지금 이걸로 저장돼 있어요' : 'Saved this way now' : ko ? '저장하고 바로 후기를 남겨요' : 'Save it and leave a review',
        icon: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }, onPress: () => { void entry.choose('been').then(done => { if (done) onBeen?.(); }); } },
      ...(saved ? [{ key: 'remove', analyticsId: 'save.place.remove', label: ko ? '저장 해제' : 'Unsave', danger: true,
        icon: { ios: 'bookmark.slash', android: 'bookmark_remove', web: 'bookmark_remove' } as const, onPress: () => { void entry.choose(null); } }] : []),
    ]} />}
  </>;
}

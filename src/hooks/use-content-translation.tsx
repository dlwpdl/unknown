import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { requestContentTranslation, isDeviceTranslationSupported, resetContentTranslations } from '@/lib/content-translation';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { needsContentTranslation, type TranslationKind, type TranslationSource } from '@/lib/translation-source';

type TranslationMode = 'off' | 'manual' | 'auto';
const PreferenceContext = createContext<{
  mode: TranslationMode; ready: boolean; saving: boolean;
  requestMode: (mode: TranslationMode) => Promise<boolean>;
} | null>(null);

export function ContentTranslationProvider({ children }: PropsWithChildren) {
  const { isAuthed, me } = useAuth();
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const scope = isAuthed ? me.id : null;
  useEffect(() => { resetContentTranslations(); }, [scope]);
  const current = useRef(scope);
  useLayoutEffect(() => { current.current = scope; }, [scope]);
  const [saved, setSaved] = useState<{ scope: string | null; mode: TranslationMode; ready: boolean }>({ scope: null, mode: 'off', ready: false });
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const mode = saved.scope === scope ? saved.mode : 'off';
  const ready = !scope || saved.scope === scope && saved.ready;

  useEffect(() => {
    let active = true;
    if (!scope) return;
    void AsyncStorage.getItem('gling.device-translation.v1:' + scope).catch(() => null).then((value) => {
      if (active) setSaved({ scope, mode: value === 'auto' || value === 'manual' ? value : 'off', ready: true });
    });
    return () => { active = false; };
  }, [scope]);

  const save = useCallback(async (next: TranslationMode) => {
    if (!scope || !ready || busy.current || current.current !== scope) return false;
    busy.current = true;
    setSaving(true);
    try {
      await AsyncStorage.setItem('gling.device-translation.v1:' + scope, next);
      if (current.current !== scope) return false;
      setSaved({ scope, mode: next, ready: true });
      return true;
    } catch {
      play('warning');
      Alert.alert(language === 'en' ? 'Could not save translation settings' : '번역 설정을 저장하지 못했어요',
        language === 'en' ? 'Please try again.' : '다시 시도해 주세요.');
      return false;
    }
    finally { busy.current = false; setSaving(false); }
  }, [scope, ready, language, play]);

  const requestMode = useCallback(async (next: TranslationMode) => {
    if (!scope || !ready || busy.current || !isDeviceTranslationSupported()) return false;
    if (next === 'off' || mode !== 'off') return save(next);
    return new Promise<boolean>((resolve) => {
      let answered = false;
      Alert.alert(language === 'en' ? 'Use on-device translation?' : '기기에서 번역할까요?',
        language === 'en'
          ? 'Google Translate processes text on your phone. First use downloads Korean/English language packs over Wi-Fi (about 30 MB per model). Originals stay unchanged.'
          : 'Google Translate가 휴대폰에서 번역해요. 처음에는 Wi-Fi로 한·영 언어팩을 내려받아요(모델당 약 30MB). 원문은 그대로 보존돼요.',
        [
          { text: language === 'en' ? 'Cancel' : '취소', style: 'cancel', onPress: () => { answered = true; play('selection'); resolve(false); } },
          { text: language === 'en' ? 'Use translation' : '번역 사용', onPress: () => {
            answered = true; play('selection');
            if (current.current !== scope) { resolve(false); return; }
            void save(next).then(resolve);
          } },
        ], { cancelable: true, onDismiss: () => { if (!answered) resolve(false); } });
    });
  }, [scope, ready, mode, save, language, play]);

  return <PreferenceContext.Provider value={{ mode, ready, saving, requestMode }}>{children}</PreferenceContext.Provider>;
}

export function useTranslationPreference() {
  const context = useContext(PreferenceContext);
  if (!context) return { mode: 'off' as const, ready: false, saving: false, requestMode: async () => false };
  return context;
}

type State = { key: string; status: 'idle' | 'loading' | 'ready' | 'error'; translation?: TranslationSource; error?: string; original?: boolean };

export function useContentTranslation(kind: TranslationKind, id: string, source: TranslationSource, visible = true) {
  const { isAuthed, me } = useAuth();
  const { language } = useLanguage();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active' || AppState.currentState === null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  const preference = useTranslationPreference();
  const request = useMemo(() => ({ kind, id, language, source: { title: source.title, body: source.body } }), [kind, id, language, source.title, source.body]);
  const key = JSON.stringify([isAuthed ? me.id : null, request]);
  const supported = isDeviceTranslationSupported();
  const eligible = isAuthed && needsContentTranslation(source, language);
  const current = useRef({ key, active: focused && foreground });
  useLayoutEffect(() => { current.current = { key, active: focused && foreground }; }, [key, focused, foreground]);
  const mounted = useRef(true);
  const counter = useRef(0);
  const loaded = useRef('');
  const controllers = useRef(new Set<AbortController>());
  const [state, setState] = useState<State>({ key, status: 'idle' });
  useEffect(() => {
    if (!focused || !foreground) controllers.current.forEach(controller => controller.abort());
  }, [focused, foreground]);

  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    return () => { mounted.current = false; active.forEach(controller => controller.abort()); };
  }, []);

  useEffect(() => {
    const active = controllers.current;
    return () => { active.forEach(controller => controller.abort()); };
  }, [key]);

  const run = useCallback(async (controller = new AbortController()) => {
    if (!supported || !eligible || !mounted.current || current.current.key !== key || !current.current.active) return;
    const sequence = ++counter.current;
    loaded.current = '';
    controllers.current.add(controller);
    setState({ key, status: 'loading' });
    const active = () => mounted.current && current.current.key === key && counter.current === sequence;
    try {
      const translation = await requestContentTranslation(me.id, request, controller.signal);
      if (active() && current.current.active && !controller.signal.aborted) {
        loaded.current = key;
        setState({ key, status: 'ready', translation, original: false });
      } else if (active()) setState({ key, status: 'idle' });
    } catch (error) {
      if (active()) setState({ key, status: controller.signal.aborted ? 'idle' : 'error', error: controller.signal.aborted ? undefined : error instanceof Error ? error.message : 'TRANSLATION_UNAVAILABLE' });
    } finally { controllers.current.delete(controller); }
  }, [supported, eligible, key, request, me.id]);

  useEffect(() => {
    if (preference.mode !== 'auto' || !preference.ready || !visible || !focused || !foreground || !eligible || loaded.current === key) return;
    const controller = new AbortController();
    void run(controller);
    return () => { controller.abort(); };
  }, [key, preference.mode, preference.ready, visible, focused, foreground, eligible, run]);

  const present = state.key === key ? state : { key, status: 'idle' as const };
  const translated = preference.mode !== 'off' && !!present.translation;
  const display = translated && !present.original ? present.translation! : source;
  const action = async () => {
    if (translated) { setState(value => ({ ...value, original: !value.original })); return; }
    if (!preference.ready || preference.saving || present.status === 'loading') return;
    if (preference.mode === 'off' && !await preference.requestMode('manual')) return;
    if (mounted.current && current.current.key === key && current.current.active) await run();
  };
  return { display, eligible, supported, translated, original: !!present.original, loading: present.status === 'loading', error: present.error, ready: preference.ready, action };
}

import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { LoginPanel } from '@/components/login-panel';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SavedLibraryButton } from '@/components/saved-library';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getCityPlaces, type CityPlace } from '@/lib/city-places';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import {
  classifyImportInput, extractPlaceNames, googlePlaceFromUrl, matchPlaces, parseTakeoutFile, readGoogleList, readInstagramCaption,
  type ImportCandidate,
} from '@/lib/place-import';
import { createSavedFolder, loadSavedFolders, setSavedItem, setSavedItemFolders } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

// Where a name came from, as the suggest_places RPC records it.
type Source = 'text' | 'google-list' | 'takeout' | 'instagram' | 'tiktok' | 'manual';
type Step =
  | { kind: 'input' } | { kind: 'working'; done?: number; total?: number }
  | { kind: 'pick'; source: 'instagram' | 'tiktok' }
  | { kind: 'done'; folder: string; saved: string[]; failed: number; asked: number; askFailed: boolean };

const MAX_FILE = 5 * 1024 * 1024;
const placeKey = (place: CityPlace) => `${place.cityId}:${place.id}`;

// Owner 2026-11-04 "유저가 뭐 넣게하고싶지않아 개불편하니까": whatever is found is saved straight away and the rest goes to the team,
// so a share needs no ticking, picking or naming. Only a video with no readable place asks the member for a name.
export default function ImportScreen() {
  const auth = useAuth(), theme = useTheme(), router = useRouter(), { city } = useCommunityCity();
  const { language } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [text, setText] = useState(''), [step, setStep] = useState<Step>({ kind: 'input' });
  const [error, setError] = useState<string | null>(null), [query, setQuery] = useState('');
  const run = useRef(0);
  const cityPlaces = useMemo(() => getCityPlaces(city.id), [city.id]);
  const allPlaces = useMemo(() => [...cityPlaces, ...CITIES.filter(item => item.id !== city.id).flatMap(item => getCityPlaces(item.id))], [city.id, cityPlaces]);
  const today = new Date();
  const defaultFolder = ko ? `가져온 곳 · ${today.getMonth() + 1}월 ${today.getDate()}일` : `Imported ${today.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
  const emptyError = ko ? '찾을 이름이 없어요. 가게 이름이나 링크를 넣어 주세요.' : 'Nothing to look for yet. Add a place name or a link.';

  // Text or a link shared from another app; taken once, then cleared so it doesn't come back.
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = (shareIntent.text || shareIntent.webUrl || '').trim().slice(0, 10000);
    resetShareIntent();
    if (shared) void find(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  const askNames = async (body: { text: string }) => {
    const result = await supabase.functions.invoke('extract-place-names', { body });
    return result.error ? null : result.data;
  };

  // Same-day imports share one folder instead of piling up folders with the same name.
  async function folderFor(name: string) {
    const same = (await loadSavedFolders(supabase)).find(item => item.name === name);
    return same ?? createSavedFolder(supabase, name);
  }

  // Returns false when a request could not be sent; names go grouped by where they came from.
  // shortcut: every name is filed under the member's city, so a list from another city lands in the wrong queue; split by city if that shows up in the queue.
  async function sendAsks(names: string[], from: Source) {
    try {
      // suggest_places refuses more than 200 names in one call.
      for (let at = 0; at < names.length; at += 200) {
        const { error: failed } = await supabase.rpc('suggest_places', { p_city_id: city.id, p_names: names.slice(at, at + 200), p_source: from });
        if (failed) return false;
      }
      return true;
    } catch { return false; }
  }

  async function saveAll(places: CityPlace[], asks: string[], from: Source, title: string, ticket: number) {
    let folder = '', failed = 0;
    const saved: string[] = [];
    if (places.length) {
      let target;
      try { target = await folderFor(title.trim().slice(0, 80) || defaultFolder); }
      catch { if (ticket === run.current) { play('warning'); setError(ko ? '저장하지 못했어요. 잠시 뒤 다시 해 주세요.' : 'Couldn’t save. Try again shortly.'); setStep({ kind: 'input' }); } return; }
      folder = target.name;
      setStep({ kind: 'working', done: 0, total: places.length });
      for (const place of places) {
        try {
          const state = await setSavedItem(supabase, { kind: 'place', id: place.id, cityId: place.cityId }, true);
          // The folder RPC replaces an item's folders, so keep the ones it already had.
          await setSavedItemFolders(supabase, state.target, [...new Set([...state.folderIds, target.id])]);
          saved.push(place.name);
        } catch { failed++; }
        if (ticket === run.current) setStep({ kind: 'working', done: saved.length + failed, total: places.length });
      }
    }
    const askFailed = asks.length ? !(await sendAsks(asks, from)) : false;
    if (ticket !== run.current) return;
    if (!places.length && askFailed) { play('warning'); setError(ko ? '추가 요청을 보내지 못했어요. 잠시 뒤 다시 해 주세요.' : 'Couldn’t send the request. Try again shortly.'); setStep({ kind: 'input' }); return; }
    play(failed || askFailed ? 'warning' : 'success');
    setStep({ kind: 'done', folder, saved, failed, asked: asks.length, askFailed });
  }

  async function importAll(candidates: ImportCandidate[], title: string, from: Source, ticket: number) {
    // Names with a position can be anywhere in Canada; a bare name is looked up in the member's own city.
    const located = candidates.filter(item => item.latitude != null && item.longitude != null);
    const named = candidates.filter(item => item.latitude == null || item.longitude == null);
    const places = new Map<string, CityPlace>(), asks = new Map<string, string>();
    for (const match of [...matchPlaces(located, allPlaces), ...matchPlaces(named, cityPlaces)]) {
      // shortcut: a chain with several locations takes the closest name match; the member can swap it in the saved list.
      const place = match.status === 'found' ? match.place : match.status === 'branch' ? match.options[0] : null;
      if (place) places.set(placeKey(place), place);
      else asks.set(match.input.name.toLowerCase(), match.input.name);
    }
    if (ticket !== run.current) return;
    if (!places.size && !asks.size) { setError(emptyError); setStep({ kind: 'input' }); return; }
    await saveAll([...places.values()], [...asks.values()], from, title, ticket);
  }

  function pickSocial(source: 'instagram' | 'tiktok') { setQuery(''); setStep({ kind: 'pick', source }); }

  async function find(raw: string) {
    setText(raw);
    const value = raw.trim();
    if (!value) { setError(emptyError); return; }
    const ticket = ++run.current;
    setError(null);
    const input = classifyImportInput(value);
    const from: Source = input.kind === 'social' ? input.network : input.kind === 'text' ? 'text' : 'google-list';
    if (input.kind === 'social' && input.network === 'tiktok') { pickSocial('tiktok'); return; }
    setStep({ kind: 'working' });
    try {
      let candidates: ImportCandidate[], title = '';
      if (input.kind === 'social') {
        // Owner pick 2026-11-04 (import-reels): read the reel's caption the way a link preview does; anything short of a name falls back to the member picking.
        const post = await readInstagramCaption(input.url);
        const names = post ? await extractPlaceNames(post.caption, askNames, { split: false }) : [];
        // The account counts only when it is already a gling place, so a creator's name never lands in the list or in suggestions.
        const account = post ? matchPlaces([{ name: post.account }], cityPlaces)[0] : undefined;
        candidates = [...(account && account.status !== 'missing' ? [post!.account] : []), ...names].map(name => ({ name }));
        if (!candidates.length) { if (ticket === run.current) pickSocial('instagram'); return; }
      } else if (input.kind === 'google-list' || input.kind === 'google-place') {
        const single = input.kind === 'google-place' ? googlePlaceFromUrl(input.url) : null;
        const list = single ? { title: '', places: [single] } : await readGoogleList(input.url);
        candidates = list.places;
        title = list.title;
      } else candidates = (await extractPlaceNames(input.text, askNames)).map(name => ({ name }));
      if (ticket === run.current) await importAll(candidates, title, from, ticket);
    } catch {
      if (ticket !== run.current) return;
      if (input.kind === 'social') { pickSocial('instagram'); return; }
      setError(ko ? '이 목록은 읽지 못했어요. 목록이 공개인지 확인하거나, 아래 구글 파일로 가져와 주세요.' : 'Couldn’t read this list. Check that it’s shared publicly, or use a Google file below.');
      setStep({ kind: 'input' });
    }
  }

  async function pickFile() {
    setError(null);
    const fileError = ko ? '이 파일은 읽지 못했어요. 구글에서 받은 CSV나 JSON 파일을 골라 주세요.' : 'Couldn’t read this file. Pick the CSV or JSON file from Google.';
    const ticket = ++run.current;
    try {
      // Loaded on tap: builds made before this picker shipped have no native module, and a top-level import would stop the whole app.
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/json', 'application/geo+json', 'text/plain'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.size != null && asset.size > MAX_FILE) { setError(ko ? '파일이 너무 커요. 5MB까지 읽을 수 있어요.' : 'That file is too big. Up to 5 MB.'); return; }
      setStep({ kind: 'working' });
      const content = Platform.OS === 'web' ? await asset.file!.text() : await new File(asset.uri).text();
      const places = parseTakeoutFile(asset.name, content);
      if (!places.length) { setError(fileError); setStep({ kind: 'input' }); return; }
      await importAll(places, asset.name.replace(/\.(csv|json|geojson)$/i, ''), 'takeout', ticket);
    } catch { if (ticket === run.current) { setError(fileError); setStep({ kind: 'input' }); } }
  }

  function restart() { play('selection'); run.current++; setText(''); setError(null); setStep({ kind: 'input' }); }

  if (!auth.isAuthed) return <LoginPanel reason={ko ? '가져온 곳을 저장하려면 로그인해 주세요.' : 'Sign in to save imported places.'} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  const field = [ControlStyles.field, styles.field, { borderColor: theme.line, backgroundColor: theme.card, color: theme.text }];
  const askText = query.trim();
  const pickResults = step.kind === 'pick' && askText ? allPlaces.filter(place => place.name.toLowerCase().includes(askText.toLowerCase())).slice(0, 8) : [];
  const pickFrom = step.kind === 'pick' ? step.source : 'manual';

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {step.kind === 'input' && <>
        <View style={styles.intro}><ThemedText type="section">{ko ? '다른 앱에 모아 둔 곳 가져오기' : 'Bring places from other apps'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '메모나 구글맵 목록 링크를 붙여 넣거나 구글에서 받은 파일을 고르면, 글링 지도에서 찾아 한 번에 저장해요.' : 'Paste a note or a Google Maps list link, or pick a file from Google. gling finds the places on its map and saves them together.'}</ThemedText></View>
        <TextInput value={text} onChangeText={value => { setText(value); setError(null); }} multiline maxLength={10000} textAlignVertical="top"
          accessibilityLabel={ko ? '가져올 메모나 링크' : 'Note or link to import'} placeholder={ko ? '가게 이름을 한 줄에 하나씩 적거나 링크를 붙여 넣어 주세요' : 'One place per line, or paste a link'}
          placeholderTextColor={theme.textSecondary} style={[...field, styles.note]} />
        {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <RaisedActionButton analyticsId="import.find" label={ko ? '찾아서 저장하기' : 'Find and save'} disabled={!text.trim()} onPress={() => { play('selection'); void find(text); }} />
        <View style={[styles.tip, { borderColor: theme.line }]}>
          <ThemedText type="label">{ko ? '구글맵 목록이 안 읽히면' : 'If a Google Maps list won’t load'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? 'takeout.google.com에서 ‘지도(내 장소)’를 받아 압축을 푼 뒤, 그 안의 CSV나 JSON 파일을 골라 주세요.' : 'Download “Maps (your places)” at takeout.google.com, unzip it, then pick the CSV or JSON file inside.'}</ThemedText>
          <SavedLibraryButton analyticsId="import.file" label={ko ? '구글 파일 고르기' : 'Pick a Google file'} onPress={() => { play('selection'); void pickFile(); }} />
        </View>
        <View style={[styles.tip, { borderColor: theme.line }]}>
          <ThemedText type="label">{ko ? '인스타 릴스·틱톡' : 'Instagram Reels and TikTok'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '영상에서 공유 버튼을 누르고 글링을 고르면 영상 속 가게를 찾아 바로 저장해요.' : 'Tap Share on the video and choose gling. It finds the place in the video and saves it.'}</ThemedText>
        </View>
      </>}

      {step.kind === 'working' && <GlingLoader color={theme.accent} style={styles.state}
        accessibilityLabel={step.total ? ko ? `저장하는 중 ${step.done ?? 0}/${step.total}` : `Saving ${step.done ?? 0} of ${step.total}` : ko ? '글링 지도에서 찾는 중' : 'Looking on the gling map'} />}

      {step.kind === 'pick' && <>
        <View style={styles.intro}><ThemedText type="section">{ko ? '영상에 나온 가게를 골라 주세요' : 'Which place is in the video?'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '영상 설명에서 가게 이름을 못 찾았어요. 이름 두세 글자만 써도 찾을 수 있어요.' : 'We couldn’t find a place name in the post’s caption. A few letters of the name is enough.'}</ThemedText></View>
        <TextInput value={query} onChangeText={setQuery} autoFocus maxLength={80} accessibilityLabel={ko ? '가게 이름 검색' : 'Search a place'} placeholder={ko ? '가게 이름' : 'Place name'} placeholderTextColor={theme.textSecondary} style={field} />
        {pickResults.map(place => <Pressable key={placeKey(place)} analyticsId="import.pick" accessibilityRole="button" accessibilityLabel={place.name}
          onPress={() => { play('selection'); const ticket = ++run.current; setStep({ kind: 'working' }); void saveAll([place], [], pickFrom, '', ticket); }}
          style={({ pressed }) => [styles.row, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : 1 }]}>
          <ThemedText type="smallBold">{place.name}</ThemedText><ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{place.address}</ThemedText></Pressable>)}
        {!!askText && !pickResults.length && <ThemedText type="supporting" themeColor="textSecondary">{ko ? '글링 지도에는 아직 없어요. 이름이 맞으면 아래에서 추가 요청해 주세요.' : 'Not on the gling map yet. If the name is right, ask us to add it below.'}</ThemedText>}
        {askText.length > 1 && <SavedLibraryButton analyticsId="import.ask" label={ko ? `‘${askText}’ 추가 요청하기` : `Ask us to add “${askText}”`}
          onPress={() => { play('selection'); const ticket = ++run.current; setStep({ kind: 'working' }); void saveAll([], [askText.slice(0, 120)], pickFrom, '', ticket); }} />}
        <SavedLibraryButton analyticsId="import.pick.back" label={ko ? '돌아가기' : 'Back'} onPress={restart} />
      </>}

      {step.kind === 'done' && <>
        <StateCard layout="start" mark="check" analyticsId="import.done"
          title={step.folder ? ko ? `‘${step.folder}’에 ${step.saved.length}곳을 저장했어요` : `Saved ${step.saved.length} ${step.saved.length === 1 ? 'place' : 'places'} to “${step.folder}”` : ko ? `${step.asked}곳 추가 요청을 보냈어요` : `Sent ${step.asked} add ${step.asked === 1 ? 'request' : 'requests'}`}
          body={[
            step.folder && (ko ? '지도의 ‘보여 줄 곳’에서 ‘내가 저장한 곳’을 고르면 바로 보여요.' : 'On the map, set “Show on map” to “Places I saved” to see them.'),
            step.failed > 0 && (ko ? `${step.failed}곳은 저장하지 못했어요.` : `${step.failed} couldn’t be saved.`),
            step.asked > 0 && (step.askFailed ? ko ? '못 찾은 곳 추가 요청은 보내지 못했어요. 잠시 뒤 다시 해 주세요.' : 'The requests for places we couldn’t find didn’t go through. Try again shortly.'
              : ko ? `${step.folder ? `못 찾은 ${step.asked}곳은 ` : ''}저희가 확인해서 지도에 올리면 저장해 두고 알려 드릴게요.` : `${step.folder ? `For the ${step.asked} we couldn’t find, once` : 'Once'} we check and add them to the map, we’ll save them for you and let you know.`),
          ].filter(Boolean).join(' ')}
          actionLabel={ko ? '저장 목록 보기' : 'See saved'} onAction={() => router.replace('/profile/saved')}>
          {!!step.saved.length && <View style={styles.saved}>{step.saved.slice(0, 5).map((name, index) => <ThemedText key={`${index}:${name}`} type="smallBold" numberOfLines={1}>✓ {name}</ThemedText>)}
            {step.saved.length > 5 && <ThemedText type="small" themeColor="textSecondary">{ko ? `외 ${step.saved.length - 5}곳` : `and ${step.saved.length - 5} more`}</ThemedText>}</View>}
        </StateCard>
        <SavedLibraryButton analyticsId="import.restart" label={ko ? '더 가져오기' : 'Import more'} onPress={restart} />
      </>}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  body: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  intro: { gap: Spacing.one }, field: { minHeight: 48, fontSize: 16, paddingVertical: Spacing.two },
  note: { minHeight: 140 }, tip: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two, alignItems: 'flex-start' },
  state: { marginTop: Spacing.five }, row: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  saved: { gap: Spacing.one, alignSelf: 'stretch' },
});

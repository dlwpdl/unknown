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
  type ImportCandidate, type ImportMatch,
} from '@/lib/place-import';
import { createSavedFolder, setSavedItem, setSavedItemFolders } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

// Where a name came from, as the suggest_places RPC records it.
type Source = 'text' | 'google-list' | 'takeout' | 'instagram' | 'tiktok' | 'manual';
type Row = { key: string; match: ImportMatch; picked: CityPlace | null; on: boolean; source: Source };
type Step =
  | { kind: 'input' } | { kind: 'working' }
  | { kind: 'pick'; reason: 'social' | 'missing'; rowKey?: string }
  | { kind: 'review' } | { kind: 'saving'; done: number; total: number }
  | { kind: 'done'; folder: string; saved: number; failed: number; asked: number; askFailed: boolean };

const MAX_FILE = 5 * 1024 * 1024;
const placeKey = (place: CityPlace) => `${place.cityId}:${place.id}`;

export default function ImportScreen() {
  const auth = useAuth(), theme = useTheme(), router = useRouter(), { city } = useCommunityCity();
  const { language } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [text, setText] = useState(''), [step, setStep] = useState<Step>({ kind: 'input' });
  const [rows, setRows] = useState<Row[]>([]), [folder, setFolder] = useState(''), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(''), [source, setSource] = useState<Source>('text');
  const run = useRef(0);
  const cityPlaces = useMemo(() => getCityPlaces(city.id), [city.id]);
  const allPlaces = useMemo(() => [...cityPlaces, ...CITIES.filter(item => item.id !== city.id).flatMap(item => getCityPlaces(item.id))], [city.id, cityPlaces]);
  const today = new Date();
  const defaultFolder = ko ? `가져온 곳 · ${today.getMonth() + 1}월 ${today.getDate()}일` : `Imported ${today.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;

  // Text or a link shared from another app; taken once, then cleared so it doesn't come back.
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = (shareIntent.text || shareIntent.webUrl || '').trim().slice(0, 10000);
    resetShareIntent();
    if (shared) void find(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  function review(candidates: ImportCandidate[], title: string, from: Source) {
    // Names with a position can be anywhere in Canada; a bare name is looked up in the member's own city.
    const located = candidates.filter(item => item.latitude != null && item.longitude != null);
    const named = candidates.filter(item => item.latitude == null || item.longitude == null);
    const seen = new Set<string>();
    const next = [...matchPlaces(located, allPlaces), ...matchPlaces(named, cityPlaces)].flatMap((match, index): Row[] => {
      const picked = match.status === 'found' ? match.place : null;
      if (picked) { if (seen.has(placeKey(picked))) return []; seen.add(placeKey(picked)); }
      return [{ key: `${index}:${match.input.name}`, match, picked, on: !!picked, source: from }];
    });
    if (!next.length) { setError(ko ? '찾을 이름이 없어요. 가게 이름이나 링크를 넣어 주세요.' : 'Nothing to look for yet. Add a place name or a link.'); setStep({ kind: 'input' }); return; }
    setRows(next);
    setFolder(title.trim().slice(0, 80) || defaultFolder);
    setStep({ kind: 'review' });
  }

  const askNames = async (body: { text: string }) => {
    const result = await supabase.functions.invoke('extract-place-names', { body });
    return result.error ? null : result.data;
  };
  function pickSocial() { setQuery(''); setRows([]); setStep({ kind: 'pick', reason: 'social' }); }

  async function find(raw: string) {
    setText(raw);
    const value = raw.trim();
    if (!value) { setError(ko ? '찾을 이름이 없어요. 가게 이름이나 링크를 넣어 주세요.' : 'Nothing to look for yet. Add a place name or a link.'); return; }
    const ticket = ++run.current;
    setError(null);
    const input = classifyImportInput(value);
    const from: Source = input.kind === 'social' ? input.network : input.kind === 'text' ? 'text' : 'google-list';
    setSource(from);
    if (input.kind === 'social' && input.network === 'tiktok') { pickSocial(); return; }
    setStep({ kind: 'working' });
    try {
      if (input.kind === 'social') {
        // Owner pick 2026-11-04 (import-reels): read the reel's caption the way a link preview does; anything short of a name falls back to the member picking.
        const post = await readInstagramCaption(input.url);
        const names = post ? await extractPlaceNames(post.caption, askNames, { split: false }) : [];
        if (ticket !== run.current) return;
        // The account counts only when it is already a gling place, so a creator's name never lands in the list or in suggestions.
        const account = post ? matchPlaces([{ name: post.account }], cityPlaces)[0] : undefined;
        const candidates = [...(account && account.status !== 'missing' ? [post!.account] : []), ...names];
        if (candidates.length) review(candidates.map(name => ({ name })), '', from); else pickSocial();
        return;
      }
      if (input.kind === 'google-list' || input.kind === 'google-place') {
        const single = input.kind === 'google-place' ? googlePlaceFromUrl(input.url) : null;
        const list = single ? { title: '', places: [single] } : await readGoogleList(input.url);
        if (ticket === run.current) review(list.places, list.title, from);
        return;
      }
      const names = await extractPlaceNames(input.text, askNames);
      if (ticket === run.current) review(names.map(name => ({ name })), '', from);
    } catch {
      if (ticket !== run.current) return;
      if (input.kind === 'social') { pickSocial(); return; }
      setError(ko ? '이 목록은 읽지 못했어요. 목록이 공개인지 확인하거나, 아래 구글 파일로 가져와 주세요.' : 'Couldn’t read this list. Check that it’s shared publicly, or use a Google file below.');
      setStep({ kind: 'input' });
    }
  }

  async function pickFile() {
    setError(null);
    const fileError = ko ? '이 파일은 읽지 못했어요. 구글에서 받은 CSV나 JSON 파일을 골라 주세요.' : 'Couldn’t read this file. Pick the CSV or JSON file from Google.';
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
      setSource('takeout');
      review(places, asset.name.replace(/\.(csv|json|geojson)$/i, ''), 'takeout');
    } catch { setError(fileError); setStep({ kind: 'input' }); }
  }

  function choose(place: CityPlace) {
    play('selection');
    if (step.kind === 'pick' && step.rowKey) {
      setRows(current => current.map(row => row.key === step.rowKey ? { ...row, picked: place, on: true } : row));
    } else {
      setRows(current => current.some(row => row.picked && placeKey(row.picked) === placeKey(place)) ? current
        : [...current, { key: `pick:${placeKey(place)}`, match: { status: 'found', input: { name: place.name }, place }, picked: place, on: true, source: 'manual' }]);
      setFolder(value => value || defaultFolder);
    }
    setStep({ kind: 'review' });
  }

  // A name gling doesn't have yet goes to the team as a place suggestion (owner pick 2026-11-04, board card import-missing).
  function ask(name: string) {
    play('selection');
    const clean = name.trim().slice(0, 120);
    setRows(current => current.some(row => !row.picked && row.match.input.name.toLowerCase() === clean.toLowerCase()) ? current
      : [...current, { key: `ask:${clean}`, match: { status: 'missing', input: { name: clean } }, picked: null, on: true, source: step.kind === 'pick' && step.reason === 'social' ? source : 'manual' }]);
    setFolder(value => value || defaultFolder);
    setStep({ kind: 'review' });
  }

  // Returns false when a request could not be sent; names go grouped by where they came from.
  // shortcut: every name is filed under the member's city, so a list from another city lands in the wrong queue; split by city if that shows up in the queue.
  async function sendAsks(names: Row[]) {
    try {
      for (const from of new Set(names.map(row => row.source))) {
        const group = names.filter(row => row.source === from).map(row => row.match.input.name);
        // suggest_places refuses more than 200 names in one call.
        for (let at = 0; at < group.length; at += 200) {
          const { error } = await supabase.rpc('suggest_places', { p_city_id: city.id, p_names: group.slice(at, at + 200), p_source: from });
          if (error) return false;
        }
      }
      return true;
    } catch { return false; }
  }

  async function save() {
    const chosen = rows.filter(row => row.on && row.picked).map(row => row.picked!);
    const asks = rows.filter(row => !row.picked && row.match.status === 'missing');
    if (!chosen.length && !asks.length) return;
    play('selection');
    setError(null);
    let created = null;
    if (chosen.length) {
      try { created = await createSavedFolder(supabase, folder.trim() || defaultFolder); }
      catch { setError(ko ? '폴더를 만들지 못했어요. 폴더 이름을 바꾸거나 잠시 뒤 다시 시도해 주세요.' : 'Couldn’t make the folder. Try another name or try again shortly.'); return; }
    }
    let saved = 0, failed = 0;
    setStep({ kind: 'saving', done: 0, total: chosen.length });
    for (const place of chosen) {
      try {
        const state = await setSavedItem(supabase, { kind: 'place', id: place.id, cityId: place.cityId }, true);
        // The folder RPC replaces an item's folders, so keep the ones it already had.
        await setSavedItemFolders(supabase, state.target, [...new Set([...state.folderIds, created!.id])]);
        saved++;
      } catch { failed++; }
      setStep({ kind: 'saving', done: saved + failed, total: chosen.length });
    }
    const askFailed = asks.length ? !(await sendAsks(asks)) : false;
    if (!chosen.length && askFailed) { play('warning'); setError(ko ? '추가 요청을 보내지 못했어요. 잠시 뒤 다시 해 주세요.' : 'Couldn’t send the request. Try again shortly.'); setStep({ kind: 'review' }); return; }
    play(failed || askFailed ? 'warning' : 'success');
    setStep({ kind: 'done', folder: created?.name ?? '', saved, failed, asked: asks.length, askFailed });
  }

  function restart() { play('selection'); run.current++; setRows([]); setText(''); setError(null); setStep({ kind: 'input' }); }

  if (!auth.isAuthed) return <LoginPanel reason={ko ? '가져온 곳을 저장하려면 로그인해 주세요.' : 'Sign in to save imported places.'} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  const field = [ControlStyles.field, styles.field, { borderColor: theme.line, backgroundColor: theme.card, color: theme.text }];
  const found = rows.filter(row => row.picked), branches = rows.filter(row => !row.picked && row.match.status === 'branch'), missing = rows.filter(row => !row.picked && row.match.status === 'missing');
  const chosenCount = found.filter(row => row.on).length, askText = query.trim();
  const pickResults = step.kind === 'pick' && query.trim()
    ? allPlaces.filter(place => place.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {step.kind === 'input' && <>
        <View style={styles.intro}><ThemedText type="section">{ko ? '다른 앱에 모아 둔 곳 가져오기' : 'Bring places from other apps'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '메모나 구글맵 목록 링크를 붙여 넣거나 구글에서 받은 파일을 고르면, 글링 지도에서 찾아 한 번에 저장해요.' : 'Paste a note or a Google Maps list link, or pick a file from Google. gling finds the places on its map and saves them together.'}</ThemedText></View>
        <TextInput value={text} onChangeText={value => { setText(value); setError(null); }} multiline maxLength={10000} textAlignVertical="top"
          accessibilityLabel={ko ? '가져올 메모나 링크' : 'Note or link to import'} placeholder={ko ? '가게 이름을 한 줄에 하나씩 적거나 링크를 붙여 넣어 주세요' : 'One place per line, or paste a link'}
          placeholderTextColor={theme.textSecondary} style={[...field, styles.note]} />
        {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <RaisedActionButton analyticsId="import.find" label={ko ? '글링 지도에서 찾기' : 'Find on the gling map'} disabled={!text.trim()} onPress={() => { play('selection'); void find(text); }} />
        <View style={[styles.tip, { borderColor: theme.line }]}>
          <ThemedText type="label">{ko ? '구글맵 목록이 안 읽히면' : 'If a Google Maps list won’t load'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? 'takeout.google.com에서 ‘지도(내 장소)’를 받아 압축을 푼 뒤, 그 안의 CSV나 JSON 파일을 골라 주세요.' : 'Download “Maps (your places)” at takeout.google.com, unzip it, then pick the CSV or JSON file inside.'}</ThemedText>
          <SavedLibraryButton analyticsId="import.file" label={ko ? '구글 파일 고르기' : 'Pick a Google file'} onPress={() => { play('selection'); void pickFile(); }} />
        </View>
        <View style={[styles.tip, { borderColor: theme.line }]}>
          <ThemedText type="label">{ko ? '인스타 릴스·틱톡' : 'Instagram Reels and TikTok'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '영상에서 공유 버튼을 누르고 글링을 고르면 여기로 바로 넘어와요.' : 'Tap Share on the video and choose gling to land here.'}</ThemedText>
        </View>
      </>}

      {step.kind === 'working' && <GlingLoader color={theme.accent} accessibilityLabel={ko ? '글링 지도에서 찾는 중' : 'Looking on the gling map'} style={styles.state} />}

      {step.kind === 'pick' && <>
        <View style={styles.intro}><ThemedText type="section">{step.reason === 'social' ? ko ? '영상에 나온 가게를 골라 주세요' : 'Which place is in the video?' : ko ? '글링 지도에서 직접 찾기' : 'Search the gling map'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{step.reason === 'social' ? ko ? '영상 설명에서 가게 이름을 못 찾았어요. 이름 두세 글자만 써도 찾을 수 있어요.' : 'We couldn’t find a place name in the post’s caption. A few letters of the name is enough.' : ko ? '이름 일부만 써도 돼요.' : 'Part of the name is enough.'}</ThemedText></View>
        <TextInput value={query} onChangeText={setQuery} autoFocus maxLength={80} accessibilityLabel={ko ? '가게 이름 검색' : 'Search a place'} placeholder={ko ? '가게 이름' : 'Place name'} placeholderTextColor={theme.textSecondary} style={field} />
        {pickResults.map(place => <Pressable key={placeKey(place)} analyticsId="import.pick" accessibilityRole="button" accessibilityLabel={place.name} onPress={() => choose(place)}
          style={({ pressed }) => [styles.row, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : 1 }]}>
          <ThemedText type="smallBold">{place.name}</ThemedText><ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{place.address}</ThemedText></Pressable>)}
        {!!askText && !pickResults.length && <ThemedText type="supporting" themeColor="textSecondary">{step.rowKey ? ko ? '글링 지도에는 아직 없어요. 그대로 두면 저장할 때 추가 요청으로 같이 보내요.' : 'Not on the gling map yet. If you leave it, it’ll go to us as a request when you save.' : ko ? '글링 지도에는 아직 없어요. 이름이 맞으면 아래에서 추가 요청해 주세요.' : 'Not on the gling map yet. If the name is right, ask us to add it below.'}</ThemedText>}
        {askText.length > 1 && !step.rowKey && <SavedLibraryButton analyticsId="import.ask" label={ko ? `‘${askText}’ 추가 요청하기` : `Ask us to add “${askText}”`} onPress={() => ask(askText)} />}
        <SavedLibraryButton analyticsId="import.pick.back" label={ko ? '돌아가기' : 'Back'} onPress={() => { play('selection'); setStep(rows.length ? { kind: 'review' } : { kind: 'input' }); }} />
      </>}

      {step.kind === 'review' && <>
        <View style={styles.counts}>
          <ThemedText type="smallBold" style={[styles.count, { backgroundColor: theme.card, borderColor: theme.line }]}>{ko ? `찾은 곳 ${found.length}` : `Found ${found.length}`}</ThemedText>
          {!!branches.length && <ThemedText type="smallBold" style={[styles.count, { backgroundColor: theme.card, borderColor: theme.line }]}>{ko ? `지점 확인 ${branches.length}` : `Pick a location ${branches.length}`}</ThemedText>}
          {!!missing.length && <ThemedText type="smallBold" style={[styles.count, { backgroundColor: theme.card, borderColor: theme.line }]}>{ko ? `못 찾은 곳 ${missing.length}` : `Not found ${missing.length}`}</ThemedText>}
        </View>
        {!!branches.length && <View style={styles.section}><ThemedText type="label">{ko ? '어느 지점인가요?' : 'Which location?'}</ThemedText>
          {branches.map(row => <View key={row.key} style={[styles.row, { borderColor: theme.line, backgroundColor: theme.card }]}>
            <ThemedText type="smallBold">{row.match.input.name}</ThemedText>
            <View style={styles.wrap}>{row.match.status === 'branch' && row.match.options.map(place => <SavedLibraryButton key={placeKey(place)} analyticsId="import.branch" label={place.address || place.name}
              onPress={() => { play('selection'); setRows(current => current.map(item => item.key === row.key ? { ...item, picked: place, on: true } : item)); }} />)}</View>
          </View>)}</View>}
        {!!missing.length && <View style={styles.section}><ThemedText type="label">{ko ? '글링 지도에서 못 찾은 곳' : 'Not on the gling map'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '저장하면 여기 있는 가게는 추가 요청으로 같이 보내요. 저희가 확인해서 지도에 올리면 저장해 두고 알려 드릴게요.' : 'When you save, these go to us as requests. Once we check one and add it to the map, we’ll save it for you and let you know.'}</ThemedText>
          {missing.map(row => <View key={row.key} style={[styles.row, styles.inline, { borderColor: theme.line, backgroundColor: theme.card }]}>
            <ThemedText style={styles.grow} numberOfLines={2}>{row.match.input.name}</ThemedText>
            <SavedLibraryButton analyticsId="import.missing.search" label={ko ? '직접 찾기' : 'Search'} onPress={() => { play('selection'); setQuery(row.match.input.name.slice(0, 80)); setStep({ kind: 'pick', reason: 'missing', rowKey: row.key }); }} />
          </View>)}</View>}
        {!!found.length && <View style={styles.section}><ThemedText type="label">{ko ? '저장할 곳' : 'Places to save'}</ThemedText>
          {found.map(row => <Pressable key={row.key} analyticsId="import.toggle" accessibilityRole="checkbox" accessibilityState={{ checked: row.on }} accessibilityLabel={row.picked!.name}
            onPress={() => { play('selection'); setRows(current => current.map(item => item.key === row.key ? { ...item, on: !item.on } : item)); }}
            style={({ pressed }) => [styles.row, styles.inline, { borderColor: row.on ? theme.accent : theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : 1 }]}>
            <View style={styles.grow}><ThemedText type="smallBold">{row.picked!.name}</ThemedText><ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{row.picked!.address}</ThemedText></View>
            <ThemedText type="smallBold" style={{ color: row.on ? theme.accent : theme.textSecondary }}>{row.on ? '✓' : '○'}</ThemedText>
          </Pressable>)}</View>}
        <SavedLibraryButton analyticsId="import.add" label={ko ? '+ 가게 더 찾기' : '+ Find another place'} onPress={() => { play('selection'); setQuery(''); setStep({ kind: 'pick', reason: 'missing' }); }} />
        <View style={styles.section}><ThemedText type="label">{ko ? '저장할 폴더 이름' : 'Folder name'}</ThemedText>
          <TextInput value={folder} onChangeText={setFolder} maxLength={80} accessibilityLabel={ko ? '저장할 폴더 이름' : 'Folder name'} placeholder={defaultFolder} placeholderTextColor={theme.textSecondary} style={field} /></View>
        {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <RaisedActionButton analyticsId="import.save" disabled={!chosenCount && !missing.length} onPress={() => void save()}
          label={chosenCount ? ko ? `${chosenCount}곳 저장하기` : `Save ${chosenCount} ${chosenCount === 1 ? 'place' : 'places'}` : missing.length ? ko ? `${missing.length}곳 추가 요청하기` : `Ask us to add ${missing.length} ${missing.length === 1 ? 'place' : 'places'}` : ko ? '저장할 곳을 골라 주세요' : 'Choose places to save'} />
        <SavedLibraryButton analyticsId="import.restart" label={ko ? '처음부터 다시' : 'Start over'} onPress={restart} />
      </>}

      {step.kind === 'saving' && <GlingLoader color={theme.accent} accessibilityLabel={!step.total ? ko ? '보내는 중' : 'Sending' : ko ? `저장하는 중 ${step.done}/${step.total}` : `Saving ${step.done} of ${step.total}`} style={styles.state} />}

      {step.kind === 'done' && <StateCard layout="start" mark="check" analyticsId="import.done"
        title={step.folder ? ko ? `‘${step.folder}’에 ${step.saved}곳을 저장했어요` : `Saved ${step.saved} ${step.saved === 1 ? 'place' : 'places'} to “${step.folder}”` : ko ? `${step.asked}곳 추가 요청을 보냈어요` : `Sent ${step.asked} add ${step.asked === 1 ? 'request' : 'requests'}`}
        body={[
          step.folder && (ko ? '지도의 ‘보여 줄 곳’에서 ‘내가 저장한 곳’을 고르면 바로 보여요.' : 'On the map, set “Show on map” to “Places I saved” to see them.'),
          step.failed > 0 && (ko ? `${step.failed}곳은 저장하지 못했어요.` : `${step.failed} couldn’t be saved.`),
          step.asked > 0 && (step.askFailed ? ko ? '못 찾은 곳 추가 요청은 보내지 못했어요. 잠시 뒤 다시 해 주세요.' : 'The requests for places we couldn’t find didn’t go through. Try again shortly.'
            : ko ? `${step.folder ? `못 찾은 ${step.asked}곳은 ` : ''}저희가 확인해서 지도에 올리면 저장해 두고 알려 드릴게요.` : `${step.folder ? `For the ${step.asked} we couldn’t find, once` : 'Once'} we check and add them to the map, we’ll save them for you and let you know.`),
        ].filter(Boolean).join(' ')}
        actionLabel={ko ? '저장 목록 보기' : 'See saved'} onAction={() => router.replace('/profile/saved')} />}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  body: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  intro: { gap: Spacing.one }, field: { minHeight: 48, fontSize: 16, paddingVertical: Spacing.two },
  note: { minHeight: 140 }, tip: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two, alignItems: 'flex-start' },
  state: { marginTop: Spacing.five }, counts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  count: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, overflow: 'hidden' },
  section: { gap: Spacing.two }, row: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, grow: { flex: 1, minWidth: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});

import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { WebshopComparisonSheet } from '@/components/business-webshop';
import { GlingLoader } from '@/components/gling-loader';
import { LoginPanel } from '@/components/login-panel';
import { SavedFolderSheet, SavedItemCard, SavedLibraryButton, type SavedFolderEditor } from '@/components/saved-library';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  createSavedFolder, deleteSavedFolder, loadSavedFolders, loadSavedItems, renameSavedFolder,
  setSavedItem, setSavedItemFolders, type SavedFilter, type SavedFolder, type SavedItem, type SavedPage,
} from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';
import { loadPublicWebshop } from '@/lib/webshops';

type SavedReadOperation = { active: boolean; reading: boolean; accountId: string; key: string; visibility: ReturnType<typeof useContentVisibility> };

export default function SavedScreen() {
  const auth = useAuth(), theme = useTheme(), router = useRouter(), hidden = useContentVisibility(), focused = useIsFocused();
  const { language } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const [filter, setFilter] = useState<SavedFilter>('all'), [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const pendingSearch = search.trim() !== query;
  const key = JSON.stringify([auth.isAuthLoading ? 'loading' : auth.isAuthed ? auth.me.id : 'guest', filter, folderId, query]);
  const [result, setResult] = useState<{ key: string; visibility: typeof hidden; operation: SavedReadOperation; page: SavedPage | null; folders: SavedFolder[]; failed: boolean; appendFailed: boolean } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null), [mutationKey, setMutationKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ key: string; text: string } | null>(null);
  const [editor, setEditor] = useState<{ key: string; visibility: typeof hidden; value: SavedFolderEditor } | null>(null);
  const [offer, setOffer] = useState<{ key: string; visibility: typeof hidden; name: string; shop: NonNullable<Awaited<ReturnType<typeof loadPublicWebshop>>> } | null>(null);
  const request = useRef<SavedReadOperation | null>(null);
  const mutation = useRef<object | null>(null), comparing = useRef<object | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const current = !pendingSearch && result?.key === key && result.visibility === hidden ? result : null;
  const page = current?.page, folders = current?.folders ?? [], loading = busyKey === key || !current;
  const rows = (page?.items ?? []).filter(item => item.target.kind === 'post' ? !hidden('post', item.target.id) : item.target.kind !== 'user' || !hidden('user', item.target.id));
  const busy = mutationKey !== null;
  const editingItem = editor?.value.kind === 'item' ? editor.value.item : editor?.value.kind === 'create' ? editor.value.returnItem : null;
  const activeEditor = !pendingSearch && editor?.key === key && editor.visibility === hidden
    && (!editingItem || rows.some(item => item.key === editingItem.key)) ? editor.value : null;
  const error = message?.key === key ? message.text : null;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [scope, setScope] = useState({ key, visibility: hidden });
  if (scope.key !== key || scope.visibility !== hidden) {
    setScope({ key, visibility: hidden }); setEditor(null); setOffer(null); setMessage(null);
  }
  // Invalidate at commit, before passive focus cleanup or an old handler can dispatch.
  useLayoutEffect(() => {
    const invalidate = () => { if (request.current) request.current.active = false; };
    invalidate(); return invalidate;
  }, [key, hidden, pendingSearch, focused, revision]);
  const readPage = useCallback((cursor: SavedPage['nextCursor'] = null) => loadSavedItems(supabase, { filter, query, folderId, cursor }), [filter, query, folderId]);
  useFocusEffect(useCallback(() => {
    if (!auth.isAuthed || auth.isAuthLoading || pendingSearch || !focused) return;
    const operation = { active: true, reading: true, accountId: auth.me.id, key, visibility: hidden };
    request.current = operation; setBusyKey(key);
    void Promise.all([readPage(), loadSavedFolders(supabase)]).then(([page, folders]) => {
      if (operation.active) setResult({ key, visibility: hidden, operation, page, folders, failed: false, appendFailed: false });
    }).catch(() => {
      if (operation.active) setResult(previous => ({ key, visibility: hidden, operation,
        page: previous?.key === key && previous.visibility === hidden ? previous.page : null,
        folders: previous?.key === key && previous.visibility === hidden ? previous.folders : [], failed: true, appendFailed: false }));
    }).finally(() => { operation.reading = false; if (operation.active) setBusyKey(null); });
    return () => { operation.active = false; };
  // Refresh retries this exact account, query, folder and visibility scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isAuthed, auth.isAuthLoading, key, hidden, pendingSearch, focused, readPage, revision]));

  function activeOperation() {
    const operation = current?.operation;
    return auth.isAuthed && !auth.isAuthLoading && focused && !pendingSearch && operation?.active
      && operation.accountId === auth.me.id && operation.key === key && operation.visibility === hidden
      && request.current === operation ? operation : null;
  }
  const closeTransient = () => { setEditor(null); setOffer(null); setMessage(null); };
  const reload = () => { if (!busy) setRevision(value => value + 1); };
  async function more() {
    const operation = activeOperation();
    if (!operation || !page?.hasMore || !page.nextCursor || loading || busy || operation.reading || !operation.active) return;
    operation.reading = true; setBusyKey(key);
    try {
      const next = await readPage(page.nextCursor);
      if (!operation.active) return;
      setResult(previous => previous?.key === key && previous.visibility === hidden && previous.page ? { ...previous,
        page: { ...next, items: [...new Map([...previous.page.items, ...next.items].map(item => [item.key, item])).values()] }, failed: false, appendFailed: false } : previous);
    } catch {
      if (operation.active) { setResult(previous => previous?.key === key ? { ...previous, failed: true, appendFailed: true } : previous); play('warning'); }
    } finally { operation.reading = false; if (operation.active) setBusyKey(null); }
  }
  const retry = () => { if (current?.appendFailed) void more(); else reload(); };
  const update = (change: (page: SavedPage) => SavedPage, nextFolders?: (folders: SavedFolder[]) => SavedFolder[]) => {
    setResult(previous => previous?.key === key && previous.visibility === hidden ? { ...previous,
      page: previous.page ? change(previous.page) : null, folders: nextFolders ? nextFolders(previous.folders) : previous.folders } : previous);
  };
  async function perform(work: (operation: SavedReadOperation) => Promise<void>, failure: string) {
    const operation = activeOperation();
    if (!operation || mutation.current || operation.reading) return;
    const task = {}; mutation.current = task; setMutationKey(key); setMessage(null);
    // A verified write may update only the read scope that started it.
    const isCurrent = () => operation.active && request.current === operation;
    try {
      await work(operation);
      if (isCurrent()) play('success');
      else if (request.current?.active && request.current.accountId === operation.accountId) setRevision(value => value + 1);
    }
    catch { if (isCurrent()) { setMessage({ key, text: failure }); play('warning'); } }
    finally { if (mutation.current === task) { mutation.current = null; setMutationKey(null); } }
  }
  const remove = (item: SavedItem) => {
    void perform(async operation => {
      await setSavedItem(supabase, item.target, false);
      if (operation.active && request.current === operation) update(page => ({ ...page, items: page.items.filter(row => row.key !== item.key) }));
    }, ko ? '저장을 해제하지 못했어요. 항목은 그대로 남아 있어요. 다시 눌러주세요.' : 'Could not unsave this item. It is still saved. Please try again.');
  };
  const saveFolder = (name: string) => {
    if (!activeEditor || !['create', 'rename'].includes(activeEditor.kind)) return;
    const editing = activeEditor;
    void perform(async operation => {
      const folder = editing.kind === 'rename' ? await renameSavedFolder(supabase, editing.folder.id, name) : await createSavedFolder(supabase, name);
      if (!operation.active || request.current !== operation) return;
      update(page => page, folders => editing.kind === 'rename' ? folders.map(row => row.id === folder.id ? folder : row) : [...folders, folder]);
      setEditor(editing.kind === 'create' && editing.returnItem ? { key, visibility: hidden, value: { kind: 'item', item: { ...editing.returnItem, folderIds: [...editing.returnItem.folderIds, folder.id] } } } : null);
    }, ko ? '폴더를 저장하지 못했어요. 이름을 확인하고 다시 시도해 주세요.' : 'Could not save the folder. Check the name and try again.');
  };
  const deleteFolder = () => {
    if (activeEditor?.kind !== 'delete') return;
    const id = activeEditor.folder.id;
    return perform(async operation => {
      await deleteSavedFolder(supabase, id);
      if (!operation.active || request.current !== operation) return;
      update(page => ({ ...page, items: page.items.map(item => ({ ...item, folderIds: item.folderIds.filter(folder => folder !== id) })) }), folders => folders.filter(folder => folder.id !== id));
      setEditor(null);
      if (folderId === id) setFolderId(null);
    }, ko ? '폴더를 삭제하지 못했어요. 저장한 항목과 폴더는 유지돼요.' : 'Could not delete the folder. Your folder and saved items are unchanged.');
  };
  const assign = (ids: string[]) => {
    if (activeEditor?.kind !== 'item') return;
    const item = activeEditor.item;
    void perform(async operation => {
      await setSavedItemFolders(supabase, item.target, ids);
      if (!operation.active || request.current !== operation) return;
      update(page => ({ ...page, items: page.items.filter(row => row.key !== item.key || !folderId || ids.includes(folderId)).map(row => row.key === item.key ? { ...row, folderIds: ids } : row) }));
      setEditor(null);
    }, ko ? '폴더 정리를 저장하지 못했어요. 기존 정리는 유지돼요. 다시 시도해 주세요.' : 'Could not save the folder changes. Previous membership is unchanged. Please try again.');
  };
  async function compare(item: SavedItem) {
    const operation = activeOperation();
    if (!operation || comparing.current || !operation.active || item.target.kind !== 'merchant') return;
    const task = {}; comparing.current = task; setCompareKey(item.key); setMessage(null);
    try {
      const shop = await loadPublicWebshop(supabase, item.target.id);
      if (!operation.active || request.current !== operation) return;
      if (!shop) throw new Error('UNAVAILABLE');
      setOffer({ key, visibility: hidden, name: item.title, shop });
    } catch {
      if (operation.active && request.current === operation) { setMessage({ key, text: ko ? '지금은 웹샵 가격을 확인할 수 없어요. 잠시 후 다시 눌러주세요.' : 'Webshop prices are unavailable right now. Please try again shortly.' }); play('warning'); }
    } finally { if (comparing.current === task) { comparing.current = null; setCompareKey(null); } }
  }
  function open(item: SavedItem) {
    const id = item.target.id;
    if (item.target.kind === 'merchant') router.push({ pathname: '/company/[id]', params: { id } });
    else if (item.target.kind === 'place') router.push({ pathname: '/places/[id]', params: { id, cityId: item.target.cityId! } });
    else if (item.target.kind === 'user') router.push({ pathname: '/user/[id]', params: { id } });
    else router.push({ pathname: '/post/[id]', params: { id } });
  }
  if (!auth.isAuthed) return <LoginPanel reason={ko ? '저장한 항목을 보려면 로그인해 주세요.' : 'Sign in to see your saved items.'} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  const selectedFolder = folders.find(folder => folder.id === folderId);
  const filters: [SavedFilter, string][] = [['all', ko ? '전체' : 'All'], ['places', ko ? '장소·비즈니스' : 'Places & businesses'], ['posts', ko ? '글·모임' : 'Posts & meetups'], ['jobs', ko ? '채용' : 'Jobs'], ['users', ko ? '사람' : 'People']];
  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <FlatList<SavedItem> data={rows} keyExtractor={item => item.key} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
      refreshing={loading && !busy} onRefresh={reload}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.intro}><ThemedText type="section">{ko ? '다시 보고 싶은 것들' : 'Worth coming back to'}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '저장한 항목과 폴더는 나만 볼 수 있어요.' : 'Your saved items and folders are private.'}</ThemedText></View>
        <View style={[ControlStyles.field, styles.search, { borderColor: theme.line, backgroundColor: theme.card }]}>
          <TextInput value={search} maxLength={120} editable={!busy} accessibilityLabel={ko ? '저장한 항목 검색' : 'Search saved items'} placeholder={ko ? '저장한 항목 검색' : 'Search saved items'} placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text }]} returnKeyType="search" onChangeText={value => { closeTransient(); setSearch(value); }} onSubmitEditing={() => { play('selection'); setQuery(search.trim()); }} />
          {!!search && <Pressable analyticsId="saved.search.clear" accessibilityRole="button" accessibilityLabel={ko ? '검색어 지우기' : 'Clear search'} disabled={busy} style={ControlStyles.icon} onPress={() => { play('selection'); closeTransient(); setSearch(''); setQuery(''); }}><ThemedText accessible={false}>×</ThemedText></Pressable>}
        </View>
        <View style={styles.wrap}>{filters.map(([kind, label]) => <SavedLibraryButton key={kind} analyticsId={`saved.filter.${kind}`} label={label} selected={filter === kind} disabled={busy} onPress={() => { closeTransient(); setFilter(kind); }} />)}</View>
        <View style={styles.folders}><ThemedText type="label" themeColor="textSecondary">{ko ? '내 폴더' : 'My folders'}</ThemedText>
          <View style={styles.wrap}><SavedLibraryButton analyticsId="saved.folder.all" label={ko ? '전체 저장' : 'All saved'} selected={!folderId} disabled={busy} onPress={() => { closeTransient(); setFolderId(null); }} />
            {folders.map(folder => <SavedLibraryButton key={folder.id} analyticsId="saved.folder.select" testID={`saved.folder.${folder.id}`} label={folder.name} selected={folderId === folder.id} disabled={busy} onPress={() => { closeTransient(); setFolderId(folder.id); }} />)}
            <SavedLibraryButton analyticsId="saved.folder.new" label={ko ? '+ 새 폴더' : '+ New folder'} disabled={busy || loading} onPress={() => { closeTransient(); setEditor({ key, visibility: hidden, value: { kind: 'create' } }); }} />
            {!!selectedFolder && <SavedLibraryButton analyticsId="saved.folder.manage" label={ko ? '폴더 관리' : 'Manage folder'} disabled={busy || loading} onPress={() => { closeTransient(); setEditor({ key, visibility: hidden, value: { kind: 'rename', folder: selectedFolder } }); }} />}</View>
        </View>
        <View style={styles.summary}><ThemedText type="supporting" themeColor="textSecondary">{selectedFolder?.name ?? (ko ? '전체 저장' : 'All saved')}{current && !current.failed ? ko ? ` · ${rows.length}개 표시 중` : ` · ${rows.length} shown` : ''}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary">{ko ? '최근 저장순' : 'Recently saved'}</ThemedText></View>
        {!!error && !activeEditor && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      </View>}
      ListEmptyComponent={loading ? <GlingLoader color={theme.accent} accessibilityLabel={ko ? '저장 목록 불러오는 중' : 'Loading saved items'} style={styles.state} />
        : <View style={styles.state}><StateCard kind={current?.failed ? 'error' : 'empty'} title={current?.failed ? ko ? '저장 목록을 불러오지 못했어요' : 'Could not load saved items' : query ? ko ? '검색 결과가 없어요' : 'No matching saved items' : ko ? '아직 저장한 항목이 없어요' : 'No saved items here yet'}
          body={current?.failed ? ko ? '연결을 확인하고 다시 시도해 주세요.' : 'Check your connection and try again.' : query || folderId || filter !== 'all' ? ko ? '검색어나 필터, 폴더를 바꿔 보세요.' : 'Try another search, filter or folder.' : ko ? '마음에 드는 장소, 글, 채용 정보나 사람을 저장해 보세요. 폴더 정리는 나중에 해도 돼요.' : 'Save places, posts, jobs or people. Organize them in folders whenever you like.'}
          actionLabel={current?.failed ? ko ? '다시 시도' : 'Try again' : undefined} onAction={current?.failed ? retry : undefined} /></View>}
      ListFooterComponent={<View style={styles.footer}>
        {loading && !!rows.length && <ThemedText type="supporting" themeColor="textSecondary" accessibilityLiveRegion="polite">{ko ? '불러오는 중…' : 'Loading…'}</ThemedText>}
        {current?.failed && !!rows.length && <><ThemedText type="supporting" accessibilityRole="alert">{ko ? '목록을 불러오지 못했어요. 앞서 불러온 항목은 유지돼요.' : 'Could not load the list. Previously loaded items are still here.'}</ThemedText><SavedLibraryButton analyticsId="saved.retry" label={ko ? '다시 시도' : 'Try again'} disabled={busy || loading} onPress={retry} /></>}
        {page?.hasMore && !current?.failed && <SavedLibraryButton analyticsId="saved.more" label={ko ? '더 보기' : 'Load more'} disabled={busy || loading} onPress={() => void more()} />}
      </View>}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => <SavedItemCard item={item} folders={folders} disabled={busy || loading} compareBusy={compareKey === item.key} onOpen={() => open(item)} onRemove={() => remove(item)}
        onOrganize={() => { setMessage(null); setEditor({ key, visibility: hidden, value: { kind: 'item', item } }); }} onCompare={item.hasWebshop && item.target.kind === 'merchant' ? () => void compare(item) : undefined} />}
    />
    {activeEditor && <SavedFolderSheet key={`${key}:${activeEditor.kind}:${activeEditor.kind === 'item' ? activeEditor.item.key : activeEditor.kind === 'create' ? 'new' : activeEditor.folder.id}`}
      editor={activeEditor} folders={folders} busy={busy} error={error} onClose={() => { if (!busy) { setEditor(null); setMessage(null); } }} onCreate={saveFolder} onRename={saveFolder} onDelete={() => void deleteFolder()} onAssign={assign}
      onCreateForItem={ids => { if (activeEditor.kind === 'item') { setMessage(null); setEditor({ key, visibility: hidden, value: { kind: 'create', returnItem: { ...activeEditor.item, folderIds: ids } } }); } }}
      onRequestDelete={() => { if (activeEditor.kind === 'rename') { setMessage(null); setEditor({ key, visibility: hidden, value: { kind: 'delete', folder: activeEditor.folder } }); } }} />}
    {!pendingSearch && offer?.key === key && offer.visibility === hidden && <WebshopComparisonSheet client={supabase} shop={offer.shop} name={offer.name} visible onClose={() => setOffer(null)} />}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  list: { flexGrow: 1, paddingHorizontal: Spacing.three, paddingBottom: Spacing.five }, header: { paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.three },
  intro: { gap: Spacing.one }, search: { flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, paddingVertical: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, folders: { gap: Spacing.two },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  separator: { height: Spacing.two }, state: { marginTop: Spacing.three }, footer: { gap: Spacing.two, paddingVertical: Spacing.three },
});

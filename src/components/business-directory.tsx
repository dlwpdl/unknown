import { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlatList, Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { loadBusinessDirectory, type BusinessDirectoryItem, type BusinessDirectoryPage } from '@/lib/business-directory';
import { setSavedMerchant } from '@/lib/merchant-conveniences';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type Operation = { key: string; visibility: ReturnType<typeof useContentVisibility>; active: boolean; busy: boolean; controller: AbortController };
type Result = { key: string; visibility: Operation['visibility']; page: BusinessDirectoryPage | null; failed: boolean; appendFailed: boolean };

export function BusinessDirectory() {
  const router = useRouter(), { city } = useCommunityCity(), hidden = useContentVisibility();
  const { me, isAuthed, isAuthLoading, promptLogin } = useAuth(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const [query, setQuery] = useState(''), [industry, setIndustry] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null), [reading, setReading] = useState<Operation | null>(null);
  const [saving, setSaving] = useState<{ operation: Operation; id: string } | null>(null), [saveError, setSaveError] = useState<Operation | null>(null);
  const operation = useRef<Operation | null>(null), saveLock = useRef(false);
  const viewer = isAuthLoading ? 'loading' : isAuthed ? me.id : 'guest';
  const writes = useRef({ viewer, active: false, values: new Map<string, boolean>() });
  const key = JSON.stringify([city.id, viewer, query.trim(), industry]);
  const current = result?.key === key && result.visibility === hidden ? result : null;
  const active = (op: Operation) => op.active && operation.current === op;

  async function read(op: Operation, offset = 0) {
    if (!active(op) || op.busy) return;
    op.busy = true; setReading(op);
    try {
      const page = await loadBusinessDirectory(supabase, { cityId: city.id, query, industry, offset, signal: op.controller.signal });
      if (!active(op)) return;
      page.items = page.items.map(item => writes.current.values.has(item.id) ? { ...item, saved: writes.current.values.get(item.id)! } : item);
      setResult(previous => ({ key, visibility: hidden, failed: false, appendFailed: false,
        page: offset && previous?.key === key && previous.visibility === hidden && previous.page
          ? { ...page, items: [...new Map([...previous.page.items, ...page.items].map(item => [item.id, item])).values()] } : page }));
    } catch {
      if (active(op)) setResult(previous => offset && previous?.key === key && previous.visibility === hidden
        ? { ...previous, appendFailed: true }
        : { key, visibility: hidden, page: null, failed: true, appendFailed: false });
    } finally {
      op.busy = false;
      if (active(op)) setReading(null);
    }
  }

  // A verified save wins over older reads; refocus checks fresh server state.
  useFocusEffect(useCallback(() => {
    const scope = { viewer, active: true, values: new Map<string, boolean>() };
    writes.current = scope;
    return () => { scope.active = false; };
  }, [viewer]));

  useFocusEffect(useCallback(() => {
    if (isAuthLoading || city.state !== 'open') return;
    const op: Operation = { key, visibility: hidden, active: true, busy: false, controller: new AbortController() };
    operation.current = op;
    const timer = setTimeout(() => void read(op), query.trim() ? 200 : 0);
    return () => { op.active = false; op.controller.abort(); clearTimeout(timer); };
    // key contains every request scope; the visibility function changes on block/report updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hidden, revision, city.state]));

  async function save(item: BusinessDirectoryItem) {
    if (!isAuthed) return promptLogin(tr('비즈니스를 저장하려면 로그인해 주세요.'));
    const op = operation.current;
    if (!op || !active(op) || op.key !== key || op.visibility !== hidden || saveLock.current) return;
    const scope = writes.current;
    saveLock.current = true; setSaving({ operation: op, id: item.id }); setSaveError(null);
    try {
      const saved = await setSavedMerchant(supabase, item.id, !item.saved);
      if (scope.active && writes.current === scope) {
        scope.values.set(item.id, saved);
        setResult(previous => previous?.page
          ? { ...previous, page: { ...previous.page, items: previous.page.items.map(row => row.id === item.id ? { ...row, saved } : row) } } : previous);
      } else if (writes.current.active && writes.current.viewer === scope.viewer) {
        const pending = operation.current;
        if (pending) { pending.active = false; pending.controller.abort(); }
        setResult(null);
        setRevision(value => value + 1);
      }
    } catch { if (active(op)) { setSaveError(op); play('warning'); } }
    finally { saveLock.current = false; if (active(op)) setSaving(null); }
  }
  function more() {
    const op = operation.current;
    if (op && active(op) && op.key === key && op.visibility === hidden && current?.page?.hasMore) void read(op, current.page.nextOffset);
  }
  return <BusinessDirectoryView cityName={city.name} query={query} industry={industry}
    page={current?.page ? { ...current.page, items: current.page.items.filter(item => !hidden('user', item.id)) } : null}
    loading={!current && city.state === 'open'} loadingMore={reading?.key === key && reading.visibility === hidden && reading.active && !!current?.page}
    failed={current?.failed ?? false} appendFailed={current?.appendFailed ?? false}
    savingId={saving?.operation.key === key && saving.operation.active ? saving.id : null}
    saveError={saveError?.key === key && saveError.active || false}
    onQuery={setQuery} onIndustry={setIndustry} onSave={item => void save(item)} onMore={more}
    onRetry={() => { if (current?.appendFailed) more(); else setRevision(value => value + 1); }}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/')}
    onOpen={item => router.push({ pathname: '/company/[id]', params: { id: item.id } })} />;
}

export function BusinessDirectoryView({ cityName, query, industry, page, loading, loadingMore, failed, appendFailed, savingId, saveError, onQuery, onIndustry, onSave, onMore, onRetry, onBack, onOpen }: {
  cityName: string; query: string; industry: string | null; page: BusinessDirectoryPage | null;
  loading: boolean; loadingMore: boolean; failed: boolean; appendFailed: boolean; savingId: string | null; saveError: boolean;
  onQuery: (value: string) => void; onIndustry: (value: string | null) => void; onSave: (item: BusinessDirectoryItem) => void;
  onMore: () => void; onRetry: () => void; onBack: () => void; onOpen: (item: BusinessDirectoryItem) => void;
}) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const items = page?.items ?? [];
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={styles.header}>
      <Pressable analyticsId="business.directory.back" accessibilityRole="button" accessibilityLabel={tr('새 소식으로 돌아가기')}
        onPress={() => { play('selection'); onBack(); }} style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={IconSize.toolbar} tintColor={theme.text} />
      </Pressable>
      <View style={styles.heading}><ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{tr('비즈니스 찾기')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr(cityName)}</ThemedText></View>
    </View>
    <View style={styles.filters}>
      <View style={[styles.search, ControlStyles.field, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.inline} tintColor={theme.textSecondary} />
        <TextInput value={query} maxLength={200} onChangeText={onQuery} placeholder={tr('이름, 업종으로 검색')} placeholderTextColor={theme.textSecondary}
          accessibilityLabel={tr('비즈니스 검색')} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[styles.input, Typography.body, { color: theme.text }]} />
        {!!query && <Pressable analyticsId="business.directory.query.clear" accessibilityRole="button" accessibilityLabel={tr('검색어 지우기')}
          onPress={() => { play('selection'); onQuery(''); }} style={ControlStyles.icon}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={IconSize.inline} tintColor={theme.textSecondary} />
        </Pressable>}
      </View>
      <ScrollView analyticsId="business.directory.industries" horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
        {[null, ...new Set([...(page?.industries ?? []), ...(industry ? [industry] : [])])].map(value => <SelectionChip key={value ?? 'all'}
          analyticsId="business.directory.industry" accessibilityRole="button" accessibilityState={{ selected: industry === value }}
          selected={industry === value} onPress={() => { play('selection'); onIndustry(value); }}
          style={[ControlStyles.pill, { borderWidth: 1, borderColor: theme.line }]}>
          <ThemedText type="smallBold" style={{ color: industry === value ? theme.accentInk : theme.textSecondary }}>{value === null ? tr('전체') : tr(value)}</ThemedText>
        </SelectionChip>)}
      </ScrollView>
    </View>
    <FlatList analyticsId="business.directory.list" data={items} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}
      ListEmptyComponent={loading ? <GlingLoader color={theme.accent} accessibilityLabel={tr('비즈니스를 불러오는 중')} style={styles.state} /> : <View style={styles.state}>
        <StateCard kind={failed ? 'error' : 'empty'} title={tr(failed ? '비즈니스를 불러오지 못했어요' : '표시할 비즈니스가 없어요')}
          body={tr(failed ? '연결을 확인하고 다시 시도해 주세요.' : '다른 검색어나 업종으로 찾아보세요. 새 소식은 게시판에서 계속 볼 수 있어요.')}
          actionLabel={tr(failed ? '다시 시도' : query || industry ? '전체 보기' : '새 소식 보기')}
          onAction={failed ? onRetry : query || industry ? () => { onQuery(''); onIndustry(null); } : onBack} />
      </View>}
      ListFooterComponent={<View style={styles.footer}>
        {saveError && <ThemedText type="small" accessibilityRole="alert">{tr('저장을 바꾸지 못했어요. 다시 눌러 주세요.')}</ThemedText>}
        {appendFailed && <ThemedText type="small" accessibilityRole="alert">{tr('다음 목록을 불러오지 못했어요. 앞서 본 비즈니스는 그대로예요.')}</ThemedText>}
        {!!page?.hasMore && <Pressable analyticsId={appendFailed ? 'business.directory.retry' : 'business.directory.more'} accessibilityRole="button"
          disabled={loadingMore} accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
          onPress={() => { play('selection'); if (appendFailed) onRetry(); else onMore(); }}
          style={({ pressed }) => [ControlStyles.action, { borderWidth: 1 }, controlPresentation(theme, { pressed, busy: loadingMore }).container]}>
          <ThemedText type="smallBold">{tr(loadingMore ? '불러오는 중…' : appendFailed ? '다시 시도' : '더 보기')}</ThemedText>
        </Pressable>}
      </View>}
      renderItem={({ item, index }) => <View>
        {(index === 0 || items[index - 1].industry !== item.industry) && <ThemedText accessibilityRole="header" type="smallBold" style={styles.group}>{tr(item.industry)}</ThemedText>}
        <BusinessDirectoryRow item={item} saving={savingId === item.id} onOpen={onOpen} onSave={onSave} />
      </View>} />
  </SafeAreaView>;
}

export function BusinessDirectoryRow({ item, saving, onOpen, onSave }: { item: BusinessDirectoryItem; saving: boolean; onOpen: (item: BusinessDirectoryItem) => void; onSave: (item: BusinessDirectoryItem) => void }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const { fontScale } = useWindowDimensions();
  const photo = item.avatarUri ?? item.bannerUri, [failed, setFailed] = useState<string | null>(null);
  return <View style={[styles.business, { borderBottomColor: theme.line }]}>
    <Pressable analyticsId="business.directory.profile" accessibilityRole="button" accessibilityLabel={tr('{0} 비즈니스 프로필 보기', item.name)}
      onPress={() => { play('selection'); onOpen(item); }} style={({ pressed }) => [styles.profile, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
      <View style={[styles.photo, { backgroundColor: theme.backgroundElement }]} accessible={false}>
        {photo && failed !== photo ? <Image source={{ uri: photo }} contentFit="cover" style={StyleSheet.absoluteFill} accessible={false} onError={() => setFailed(photo)} />
          : <ThemedText type="section" themeColor="accent">{item.name.slice(0, 1)}</ThemedText>}
      </View>
      <View style={styles.businessCopy}>
        <ThemedText style={[Typography.body, { fontWeight: '700' }]}>{item.name}</ThemedText>
        {!!item.services && <ThemedText type="small" themeColor="textSecondary" numberOfLines={fontScale > 1.2 ? undefined : 2}>{item.services}</ThemedText>}
        {!!item.address && <ThemedText type="small" themeColor="textSecondary" numberOfLines={fontScale > 1.2 ? undefined : 1}>{item.address}</ThemedText>}
        {item.has_webshop && <ThemedText type="smallBold" themeColor="accent">{tr('웹샵 주문 가능')}</ThemedText>}
      </View>
    </Pressable>
    <Pressable analyticsId="business.directory.save" accessibilityRole="button" accessibilityLabel={tr(item.saved ? '{0} 저장 취소' : '{0} 저장', item.name)}
      accessibilityState={{ selected: item.saved, disabled: saving, busy: saving }} disabled={saving}
      onPress={() => { play('reaction'); onSave(item); }}
      style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', selected: item.saved, pressed, busy: saving }).container]}>
      <SymbolView name={{ ios: item.saved ? 'bookmark.fill' : 'bookmark', android: item.saved ? 'bookmark' : 'bookmark_border', web: item.saved ? 'bookmark' : 'bookmark_border' }} size={IconSize.toolbar} tintColor={item.saved ? theme.accent : theme.textSecondary} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  heading: { flex: 1, gap: Spacing.one },
  filters: { paddingHorizontal: Spacing.three },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: Spacing.two },
  chips: { gap: Spacing.two, paddingVertical: Spacing.two },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five },
  state: { paddingVertical: Spacing.four },
  footer: { gap: Spacing.three, paddingTop: Spacing.three },
  group: { paddingTop: Spacing.three, paddingBottom: Spacing.one },
  business: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  profile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, minHeight: 80 },
  photo: { width: 50, height: 50, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  businessCopy: { flex: 1, gap: Spacing.one },
});

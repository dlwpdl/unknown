import { useEffect, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMerchantMcpConnections } from '@/lib/merchant-mcp';
import { supabase } from '@/lib/supabase';

// Below this width the business web drops the sidebar for a scrollable row of the same destinations.
export const MERCHANT_SIDEBAR_MIN_WIDTH = 860;
export function useMerchantSidebar(min = MERCHANT_SIDEBAR_MIN_WIDTH) {
  const { width } = useWindowDimensions();
  // The business web is pre-rendered, so read the live browser width after hydration instead of the server's 0.
  const [webWidth, setWebWidth] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => setWebWidth(window.innerWidth);
    update(); window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return (webWidth ?? width) >= min;
}

type Icon = ComponentProps<typeof SymbolView>['name'];
export type MerchantNavItem = { key: string; label: string; icon: Icon; group?: 'tools' };

export function MerchantSidebar({ items, active, onSelect, disabled, wide }: { items: MerchantNavItem[]; active: string; onSelect: (key: string) => void; disabled?: boolean; wide: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const item = (nav: MerchantNavItem) => {
    const selected = nav.key === active;
    return <Pressable key={nav.key} analyticsId="merchant.tabs" accessibilityRole={wide ? 'link' : 'tab'} accessibilityLabel={nav.label}
      accessibilityState={{ selected, disabled: !!disabled }} aria-current={selected ? 'page' : undefined} disabled={disabled}
      onPress={() => { play('selection'); onSelect(nav.key); }}
      style={({ pressed }) => [wide ? styles.navItem : styles.navChip, { backgroundColor: selected ? theme.backgroundSelected : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
        !wide && { borderColor: selected ? theme.accent : theme.line }]}>
      <SymbolView name={nav.icon} size={18} tintColor={selected ? theme.text : theme.textSecondary} />
      <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'} numberOfLines={1}>{nav.label}</ThemedText>
    </Pressable>;
  };
  const main = items.filter(nav => nav.group !== 'tools'), tools = items.filter(nav => nav.group === 'tools');
  if (!wide) return <ScrollView analyticsId="merchant.tabs" horizontal showsHorizontalScrollIndicator={false} style={styles.navScroll} contentContainerStyle={styles.navRow}
    accessibilityRole="tablist" accessibilityLabel={tr('비즈니스 메뉴')}>{items.map(item)}</ScrollView>;
  return <View style={[styles.sidebar, { borderColor: theme.line }]} accessibilityRole="menu" accessibilityLabel={tr('비즈니스 메뉴')}>
    {main.map(item)}
    {tools.length > 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.navGroup}>{tr('운영 도구')}</ThemedText>}
    {tools.map(item)}
  </View>;
}

export type MerchantRecentItem = { key: string; title: string; detail: string; status: 'published' | 'approved' | 'draft'; onPress: () => void };

export function MerchantHome({ name, place, onChoose, purposes, purpose, onPurpose, facts, onFacts, onGenerate, onWrite, resume, recent, onAllPosts, aiOwner, onOpenAi, onOpenReviews, busy }: {
  name: string; place: string; onChoose?: () => void;
  purposes: readonly string[]; purpose: string; onPurpose: (purpose: string) => void; facts: string; onFacts: (facts: string) => void;
  onGenerate: () => void; onWrite: () => void; resume?: () => void;
  recent: MerchantRecentItem[]; onAllPosts: () => void; aiOwner: boolean; onOpenAi: () => void; onOpenReviews?: () => void; busy: boolean;
}) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const wide = useMerchantSidebar(1080);
  const [connected, setConnected] = useState<number | null>(null);
  useEffect(() => {
    if (!aiOwner) return;
    let active = true;
    void loadMerchantMcpConnections(supabase)
      .then(rows => { if (active) setConnected(rows.filter(row => !row.revoked_at && Date.parse(row.expires_at) > Date.now()).length); })
      .catch(() => { if (active) setConnected(null); });
    return () => { active = false; };
  }, [aiOwner]);
  const status = { published: tr('게시됨'), approved: tr('승인됨'), draft: tr('초안') };
  const card = [styles.card, { backgroundColor: theme.card, borderColor: theme.line }];
  const button = (label: string, onPress: () => void, analyticsId: string) => <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [styles.button, { borderColor: theme.line, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
  return <View style={styles.home}>
    <View style={styles.title}>
      <View style={styles.grow}><ThemedText type="title" numberOfLines={2}>{name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{place}</ThemedText></View>
      {onChoose && button(tr('비즈니스 변경'), onChoose, 'merchant.action')}
    </View>
    <View style={card}>
      <ThemedText type="subtitle" accessibilityRole="header">{tr('새 글 쓰기')}</ThemedText>
      {resume ? <>
        <ThemedText themeColor="textSecondary">{tr('저장하지 않은 초안이 있어요.')}</ThemedText>
        <View style={styles.row}>{button(tr('작성 중인 초안 이어쓰기'), resume, 'merchant.action')}</View>
      </> : <>
        <View style={styles.row} accessibilityRole="radiogroup">{purposes.map(label => {
          const selected = label === purpose;
          return <Pressable key={label} analyticsId="merchant.action" accessibilityRole="radio" accessibilityLabel={tr(label)} accessibilityState={{ checked: selected, disabled: busy }}
            disabled={busy} onPress={() => { play('selection'); onPurpose(label); }}
            style={({ pressed }) => [styles.chip, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="smallBold">{tr(label)}</ThemedText>
          </Pressable>;
        })}</View>
        <TextInput accessibilityLabel={tr('알릴 내용')} value={facts} onChangeText={onFacts} editable={!busy} multiline maxLength={1000}
          placeholder={tr('알릴 내용을 한두 줄 적어 주세요. 예: 토·일 오전 알바 1명, 시급 18달러')} placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
        <View style={styles.row}>
          <RaisedActionButton compact analyticsId="merchant.action" label={busy ? tr('초안 만드는 중…') : tr('AI로 초안 만들기')} disabled={busy || !facts.trim()} onPress={() => { play('selection'); onGenerate(); }} />
          {button(tr('직접 쓰기'), onWrite, 'merchant.action')}
        </View>
      </>}
    </View>
    <View style={[styles.columns, !wide && styles.stack]}>
      <View style={[card, styles.recent]}>
        <View style={styles.title}><ThemedText type="subtitle" accessibilityRole="header" style={styles.grow}>{tr('최근 글')}</ThemedText>{button(tr('전체 보기'), onAllPosts, 'merchant.action')}</View>
        {!recent.length && <ThemedText themeColor="textSecondary">{tr('아직 글이 없어요. 첫 소식을 써 보세요.')}</ThemedText>}
        {recent.map((item, index) => <Pressable key={item.key} analyticsId="merchant.open_draft" accessibilityRole="button" accessibilityLabel={`${item.title}, ${status[item.status]}`}
          disabled={busy} onPress={() => { play('selection'); item.onPress(); }}
          style={({ pressed }) => [styles.recentRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.line }, { opacity: pressed ? 0.7 : 1 }]}>
          <View style={styles.grow}><ThemedText type="smallBold" numberOfLines={1}>{item.title}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.detail}</ThemedText></View>
          <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" themeColor={item.status === 'published' ? 'accent' : 'textSecondary'}>{status[item.status]}</ThemedText></View>
        </Pressable>)}
      </View>
      <View style={styles.side}>
        {aiOwner && <View style={card}>
          <ThemedText type="subtitle" accessibilityRole="header">{tr('AI로 글쓰기')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{connected ? tr('연결된 AI {0}개', connected) : tr('Claude·ChatGPT에서 바로 글링 초안을 만들어요.')}</ThemedText>
          <View style={styles.row}>{button(connected ? tr('관리') : tr('연결하기'), onOpenAi, 'merchant.action')}</View>
        </View>}
        {onOpenReviews && <View style={card}>
          <ThemedText type="subtitle" accessibilityRole="header">{tr('이용 후기')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('답글을 달면 비즈니스 프로필에 함께 보여요.')}</ThemedText>
          <View style={styles.row}>{button(tr('후기 보기'), onOpenReviews, 'merchant.action')}</View>
        </View>}
      </View>
    </View>
  </View>;
}

export const merchantShellStyles = StyleSheet.create({
  shell: { width: '100%', maxWidth: 1180, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 16 },
  main: { flex: 1, minWidth: 0, gap: 16 },
  plain: { gap: 16 },
  content: { gap: 16, width: '100%', maxWidth: 1180, alignSelf: 'center' },
});

const styles = StyleSheet.create({
  sidebar: { width: 220, flexShrink: 0, gap: 2, paddingRight: 16, borderRightWidth: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  navItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 12 },
  navGroup: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 },
  navScroll: { flexGrow: 0 }, navRow: { gap: 8, paddingBottom: 4, alignItems: 'center' },
  navChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  home: { gap: 20 },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  card: { gap: 14, padding: 20, borderWidth: 1, borderRadius: 20, borderCurve: 'continuous' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  recent: { flex: 1.4, minWidth: 0, gap: 4 },
  side: { flex: 1, minWidth: 0, gap: 16, alignSelf: 'stretch' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
});

import type { SupabaseClient } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Share, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { Colors } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { compareWebshopPrices, loadPublicWebshop, recordWebshopSheetView, webshopOrderUrl, type Webshop } from '@/lib/webshops';

export function usePublicWebshop(client: SupabaseClient, merchantId: string | undefined, revision: unknown = null) {
  const [result, setResult] = useState<{ id: string; shop: Webshop | null; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!merchantId) return;
    const controller = new AbortController();
    void loadPublicWebshop(client, merchantId, controller.signal).then(shop => {
      if (!controller.signal.aborted) setResult({ id: merchantId, shop, failed: false });
    }).catch(() => { if (!controller.signal.aborted) setResult({ id: merchantId, shop: null, failed: true }); });
    return () => controller.abort();
  }, [client, merchantId, revision, retry]);
  return { shop: result && result.id === merchantId ? result.shop : null, failed: !!result && result.id === merchantId && result.failed,
    retry: () => setRetry(value => value + 1) };
}

export function UberOrderNotice() {
  const { language } = useLanguage();
  return <ThemedText type="caption" themeColor="textSecondary">{language === 'ko'
    ? '주문 관련 문의·클레임은 Uber 고객지원을 통해 접수해주세요.' : 'For order questions or claims, please contact Uber Support.'}</ThemedText>;
}

export function WebshopBanner({ shop, onPress }: { shop: Webshop; onPress: () => void }) {
  const { language } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const { maximumPercent } = compareWebshopPrices(shop);
  return <View style={styles.offer}>
    <Pressable analyticsId="webshop.offer" accessibilityRole="button" onPress={() => { play('selection'); onPress(); }}
      style={({ pressed }) => [styles.banner, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
      <View style={styles.grow}>
        <ThemedText type="section" style={{ color: theme === Colors.dark ? '#8FD9C4' : '#276B57' }}>{maximumPercent > 0
          ? language === 'ko' ? `최대 ${maximumPercent}% 할인` : `Save up to ${maximumPercent}%`
          : language === 'ko' ? '가게 웹샵에서 주문하기' : 'Order from the store’s webshop'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{shop.comparisons.length ? language === 'ko' ? '대표 메뉴 가격 비교 · 자세히 보기' : 'Compare selected menu prices' : language === 'ko' ? 'Uber에서 주문·결제해요' : 'Orders and payment handled by Uber'}</ThemedText>
      </View><ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
    </Pressable>
    <UberOrderNotice />
  </View>;
}

export function WebshopOrderButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme(), { language } = useLanguage(), { play } = useInteractionFeedback();
  return <View style={styles.offer}><Pressable analyticsId="webshop.order-preview" accessibilityRole="button"
    style={({ pressed }) => [ControlStyles.action, { backgroundColor: theme.accent, opacity: pressed ? 0.82 : 1 }]}
    onPress={() => { play('selection'); onPress(); }}><ThemedText type="menu" style={{ color: theme.accentInk }}>{language === 'ko' ? '웹샵 주문' : 'Order from webshop'} ↗</ThemedText></Pressable>
    <UberOrderNotice /></View>;
}

export function WebshopComparisonSheet({ client, shop, name, visible, onClose }: {
  client: SupabaseClient; shop: Webshop; name: string; visible: boolean; onClose: () => void;
}) {
  const theme = useTheme(), { language, locale } = useLanguage(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const active = useRef(true), pending = useRef<string | null>(null), started = useRef(false);
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  const { items, maximumPercent, summary } = compareWebshopPrices(shop), ko = language === 'ko';
  const money = (value: number) => `CA$${(value / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    if (visible && !started.current) {
      started.current = true; setError(''); setCopied(false);
      void recordWebshopSheetView(client, shop.merchantId, platform);
    } else if (!visible) started.current = false;
  }, [client, platform, shop.merchantId, visible]);
  const fail = () => {
    if (!active.current) return;
    setBusy(false); setError(ko ? '웹샵을 열지 못했어요. 연결을 확인하고 다시 시도해주세요.' : 'Could not open the webshop. Check your connection and try again.'); play('warning');
  };
  async function launch(url: string) {
    try { await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }); }
    catch { fail(); }
    finally { if (active.current) setBusy(false); }
  }
  function order() {
    if (busy || pending.current) return;
    play('selection'); setError('');
    try {
      const url = webshopOrderUrl(shop.merchantId, platform);
      if (platform === 'web') {
        // Open synchronously from the tap so browsers can allow the new tab.
        window.open(url, '_blank', 'noopener');
      } else if (platform === 'ios') {
        pending.current = url; setBusy(true); onClose();
      } else { setBusy(true); onClose(); void launch(url); }
    } catch { fail(); }
  }
  const close = () => { play('selection'); pending.current = null; onClose(); };
  const quote = shop.checkoutComparison;
  const feeRows = quote ? [
    ['메뉴 금액', 'Menu items', 'itemsCents'], ['배달비', 'Delivery fee', 'deliveryCents'], ['서비스 수수료', 'Service fee', 'serviceCents'],
    ['프로모션 할인', 'Promotion discount', 'discountCents'], ['세금', 'Tax', 'taxCents'], ['팁', 'Tip', 'tipCents'],
  ] as const : [];
  return <>
    {!visible && !!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    <Modal visible={visible} transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={close}
      onDismiss={() => { const url = pending.current; pending.current = null; if (url && active.current) void launch(url); }}>
      <SafeAreaProvider style={styles.backdrop}><Pressable analyticsId="webshop.close-backdrop" accessibilityRole="button" accessibilityLabel={ko ? '가격 비교 닫기' : 'Close price comparison'} onPress={close} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.background }]} accessibilityViewIsModal>
          <View style={styles.handle} accessible={false} />
          <View style={styles.heading}><View style={styles.grow}><ThemedText type="small" themeColor="textSecondary">{name}</ThemedText>
            <ThemedText type="sheetTitle" accessibilityRole="header">{summary.savingCents > 0 ? ko ? `${money(summary.savingCents)} 아낄 수 있어요` : `Save ${money(summary.savingCents)}` : ko ? '웹샵 가격을 확인해보세요' : 'Check webshop prices'}</ThemedText></View>
            <Pressable analyticsId="webshop.close" accessibilityRole="button" accessibilityLabel={ko ? '닫기' : 'Close'} onPress={close} style={ControlStyles.icon}><ThemedText>×</ThemedText></Pressable></View>
          <ScrollView analyticsId="webshop.comparison" contentContainerStyle={styles.details}>
            <ThemedText type="small" themeColor="textSecondary">{summary.kind === 'checkout'
              ? `${quote!.basketLabel} · ${ko ? quote!.fulfillment === 'delivery' ? '배달 견적' : '픽업 견적' : quote!.fulfillment === 'delivery' ? 'Delivery quote' : 'Pickup quote'}`
              : items.length ? ko ? `대표 메뉴 ${items.length}개를 함께 주문할 때의 메뉴 금액이에요.` : `Menu subtotal for these ${items.length} selected items.` : ko ? '가게의 Uber 웹샵에서 메뉴와 가격을 확인해주세요.' : 'Check menus and prices on the store’s Uber webshop.'}</ThemedText>
            {!!items.length && <View style={[styles.table, { borderColor: theme.line, backgroundColor: theme.card }]}>
              <View style={styles.row}><ThemedText type="caption" themeColor="textSecondary" style={styles.grow}>{ko ? '대표 메뉴' : 'Selected items'}</ThemedText><ThemedText type="caption" themeColor="textSecondary" style={styles.amount}>Uber Eats</ThemedText><ThemedText type="caption" themeColor="accent" style={styles.amount}>{ko ? '글링 웹샵' : 'Via Gling'}</ThemedText></View>
              {items.map(item => <View key={item.id} style={[styles.row, { borderTopWidth: 1, borderTopColor: theme.line }]}><View style={styles.grow}><ThemedText type="smallBold">{item.name}</ThemedText>{item.savingCents > 0 && <ThemedText type="caption" themeColor="accent">{item.percent}% · {money(item.savingCents)} {ko ? '절약' : 'less'}</ThemedText>}</View>
                <ThemedText type="small" style={styles.amount}>{money(item.uberCents)}</ThemedText><ThemedText type="smallBold" themeColor="accent" style={styles.amount}>{money(item.webCents)}</ThemedText></View>)}
            </View>}
            {quote && <View style={[styles.table, { borderColor: theme.line, backgroundColor: theme.card }]}>{feeRows.map(([korean, english, field]) => <View style={styles.row} key={field}><ThemedText type="small" style={styles.grow}>{ko ? korean : english}</ThemedText><ThemedText type="small" style={styles.amount}>{field === 'discountCents' ? '−' : ''}{money(quote.uber[field])}</ThemedText><ThemedText type="small" style={styles.amount}>{field === 'discountCents' ? '−' : ''}{money(quote.webshop[field])}</ThemedText></View>)}</View>}
            {(items.length > 0 || quote) && <View style={[styles.totals, { backgroundColor: theme.card, borderColor: theme.line }]}><View style={styles.row}><ThemedText type="small" style={styles.grow}>{ko ? 'Uber Eats 주문 시' : 'On Uber Eats'}</ThemedText><ThemedText>{money(summary.uberCents)}</ThemedText></View>
              <View style={styles.row}><ThemedText type="menu" themeColor="accent" style={styles.grow}>{ko ? '글링에서 웹샵 주문 시' : 'Webshop via Gling'}</ThemedText><ThemedText type="section" themeColor="accent">{money(summary.webCents)}</ThemedText></View>
              <ThemedText type="caption" themeColor="textSecondary">{summary.kind === 'menu' ? ko ? '메뉴 합계 기준 · 배달비·수수료·세금·팁 제외' : 'Menu subtotal only · excludes delivery, fees, tax and tip' : ko ? '동일 조건에서 확인한 결제 견적 기준' : 'Observed checkout quotes under the same conditions'}</ThemedText></View>}
            {maximumPercent > 0 && <ThemedText type="small" themeColor="textSecondary">{ko ? `최대 ${maximumPercent}%는 위 대표 메뉴 중 가장 큰 할인율이에요. 주문 전체에 일괄 적용되는 할인율은 아니에요.` : `Up to ${maximumPercent}% refers to the largest price saving among the selected items, and varies by item.`}</ThemedText>}
            <ThemedText type="caption" themeColor="textSecondary">{ko ? '메뉴·옵션·주소·프로모션에 따라 가격이 달라질 수 있어요. 최종 금액은 Uber 웹샵에서 확인해주세요.' : 'Prices vary with items, options, address and promotions. Confirm the final amount on the Uber webshop.'}{shop.verifiedAt ? `\n${ko ? '메뉴 가격 확인' : 'Menu prices checked'} ${new Date(shop.verifiedAt).toLocaleDateString(locale)}` : ''}{quote ? `\n${ko ? '결제 견적 확인' : 'Checkout quotes checked'} ${new Date(quote.verifiedAt).toLocaleDateString(locale)}` : ''}</ThemedText>
            {shop.promoCode && <Pressable analyticsId="webshop.copy-code" accessibilityRole="button" style={[ControlStyles.action, { borderWidth: 1, borderColor: theme.line }]} onPress={() => {
              play('selection');
              const operation = platform === 'web' ? navigator.clipboard.writeText(shop.promoCode!) : Share.share({ message: shop.promoCode! });
              void operation.then(() => { if (active.current && platform === 'web') { setCopied(true); play('success'); } }).catch(() => { if (active.current) { setError(ko ? '코드를 복사하지 못했어요. 코드를 길게 눌러 복사해주세요.' : 'Could not copy. Press and hold the code to copy it.'); play('warning'); } });
            }}><ThemedText type="smallBold" selectable>{copied ? ko ? '코드 복사됨 · 결제할 때 붙여넣기' : 'Code copied · paste at checkout' : `${shop.promoCode} · ${platform === 'web' ? ko ? '코드 복사' : 'Copy code' : ko ? '코드 공유·복사' : 'Share or copy code'}`}</ThemedText></Pressable>}
          </ScrollView>
          {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
          <View style={styles.offer}><Pressable analyticsId="webshop.order" accessibilityRole="button" disabled={busy} accessibilityState={{ busy, disabled: busy }} onPress={order}
            style={({ pressed }) => [ControlStyles.action, { backgroundColor: theme.accent, opacity: busy ? 0.45 : pressed ? 0.82 : 1 }]}><ThemedText type="menu" style={{ color: theme.accentInk }}>{busy ? ko ? '여는 중…' : 'Opening…' : ko ? maximumPercent > 0 ? '할인받고 주문하러 가기 ↗' : '웹샵에서 주문하러 가기 ↗' : 'Order from webshop ↗'}</ThemedText></Pressable><UberOrderNotice /></View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  offer: { gap: 8 }, grow: { flex: 1, minWidth: 0, gap: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 16, minHeight: 80 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 16 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#8888', alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 4 }, details: { gap: 16, paddingBottom: 8 },
  table: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 }, amount: { width: 76, textAlign: 'right', fontVariant: ['tabular-nums'] },
  totals: { borderWidth: 1, borderRadius: 16, padding: 16 },
});

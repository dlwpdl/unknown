import { Image } from 'expo-image';
import { useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { Share, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { ScrollView, Switch } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { DragSheet } from '@/components/drag-sheet';
import { PostPhotoCredits } from '@/components/post-photo-credits';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, Typography } from '@/constants/design-system';
import { Colors, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { listShareCard, placeShareCard, SHARE_CARD_SIZE, shareCardSenderName, type ShareCard, type ShareCardCity, type ShareCardTone } from '@/lib/share-card';
import { supabase } from '@/lib/supabase';

export type ShareCardTarget = { kind: 'place'; place: CityPlace; city: ShareCardCity } | { kind: 'list'; name: string; places: CityPlace[]; count: number | null };

export const SHARE_CARD_ACTION = '다른 앱으로 공유';
// shortcut: 그림 파일 공유는 react-native-view-shot·expo-sharing 승인 뒤, 승인되면 이 함수만 바꾼다
/** Sends the card out of the app; true when the person finished sharing. Until the image modules land it shares the card's text and map link. */
export async function exportShareCard(card: ShareCard, _view: RefObject<ViewInstance | null>): Promise<boolean> {
  const result = await Share.share({ message: card.message });
  return result.action === Share.sharedAction;
}

const wordmark = { dark: require('@/assets/brand/gling-night-wordmark.png'), light: require('@/assets/brand/gling-night-wordmark-light.png') };

/**
 * The 9:16 card itself. Every size is the 360pt design scaled to `width`, so the sheet preview and a capture match.
 * Text ignores the font-size setting: the card is a fixed picture, and its whole content is the accessibility label.
 */
export function ShareCardView({ card, tone, width, ref }: { card: ShareCard; tone: ShareCardTone; width: number; ref?: Ref<ViewInstance> }) {
  const palette = Colors[tone], s = width / SHARE_CARD_SIZE.width;
  const type = (role: keyof typeof Typography, color: string) => ({ ...Typography[role], fontSize: Typography[role].fontSize * s, lineHeight: Typography[role].lineHeight * s, letterSpacing: Typography[role].letterSpacing * s, color });
  const text = { allowFontScaling: false };
  const photo = (place: CityPlace, style: StyleProp<ViewStyle>) => <CityPlacePhoto place={place} style={[style, { backgroundColor: palette.backgroundElement }]} />;
  return <View ref={ref} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={card.label}
    style={[styles.card, { width, height: width * 16 / 9, backgroundColor: palette.background, paddingTop: 76 * s, paddingBottom: 104 * s, paddingHorizontal: 28 * s }]}>
    {/* One soft accent glow behind the logo, the night brand's light source. */}
    <View pointerEvents="none" style={[styles.glow, { top: -150 * s, left: -130 * s, width: 300 * s, height: 300 * s, borderRadius: 150 * s, backgroundColor: `${palette.accent}${tone === 'dark' ? '26' : '14'}`,
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 120 * s, spreadDistance: 40 * s, color: `${palette.accent}${tone === 'dark' ? '2E' : '1A'}` }] }]} />
    <View style={styles.header}>
      <Image source={wordmark[tone]} contentFit="contain" accessible={false} style={{ width: 72 * s, height: 30 * s }} />
      {!!card.badge && <View style={[styles.badge, { borderColor: palette.line, borderWidth: Math.max(1, s), paddingHorizontal: 10 * s, paddingVertical: 3 * s }]}>
        <ThemedText {...text} numberOfLines={1} style={type('caption', palette.textSecondary)}>{card.badge}</ThemedText>
      </View>}
    </View>
    {card.kind === 'place' ? <>
      {card.photo ? photo(card.photo, [styles.fill, { marginTop: 20 * s, borderRadius: 20 * s }]) : <View style={styles.fill} />}
      {!!card.credit && <ThemedText {...text} numberOfLines={4} style={[type('micro', palette.textSecondary), { marginTop: 8 * s }]}>{card.credit}</ThemedText>}
      <ThemedText {...text} numberOfLines={1} style={[type('label', palette.accent), { marginTop: 20 * s }]}>{card.eyebrow}</ThemedText>
      <ThemedText {...text} numberOfLines={card.photo ? 3 : 4} style={[type(card.photo ? 'sheetTitle' : 'display', palette.text), { marginTop: 4 * s, fontWeight: '700' }]}>{card.title}</ThemedText>
    </> : <>
      <ThemedText {...text} numberOfLines={1} style={[type('label', palette.accent), { marginTop: 28 * s }]}>{card.eyebrow}</ThemedText>
      <ThemedText {...text} numberOfLines={2} style={[type('sheetTitle', palette.text), { marginTop: 2 * s }]}>{card.title}</ThemedText>
      <View style={[styles.fill, { marginTop: 20 * s, gap: 10 * s }]}>
        {card.items.map((item, index) => <View key={index} style={[styles.row, { maxHeight: 64 * s, gap: 14 * s }]}>
          {item.photo ? photo(item.photo, [styles.thumb, { borderRadius: 14 * s }])
            : <View style={[styles.thumb, styles.center, { borderRadius: 14 * s, backgroundColor: palette.backgroundElement }]}>
              <ThemedText {...text} style={type('section', palette.textSecondary)}>{index + 1}</ThemedText>
            </View>}
          <ThemedText {...text} numberOfLines={2} style={[type('menu', palette.text), styles.rowName]}>{item.name}</ThemedText>
        </View>)}
        {!!card.more && <ThemedText {...text} style={type('supporting', palette.textSecondary)}>{card.more}</ThemedText>}
        {!!card.empty && <ThemedText {...text} style={type('supporting', palette.textSecondary)}>{card.empty}</ThemedText>}
      </View>
      {!!card.credit && <ThemedText {...text} numberOfLines={4} style={[type('micro', palette.textSecondary), { marginTop: 8 * s }]}>{card.credit}</ThemedText>}
    </>}
    {!!card.sender && <ThemedText {...text} numberOfLines={1} style={[type('supporting', palette.textSecondary), { marginTop: 12 * s }]}>{card.sender}</ThemedText>}
    <View style={{ marginTop: 16 * s, paddingTop: 10 * s, borderTopWidth: Math.max(StyleSheet.hairlineWidth, s), borderTopColor: palette.line }}>
      <ThemedText {...text} numberOfLines={2} style={type('supporting', palette.textSecondary)}>{card.footer}</ThemedText>
    </View>
  </View>;
}

function photoCredits(card: ShareCard, tr: (text: string, ...values: unknown[]) => string) {
  const photos = [...new Map([card.photo, ...card.items.map(item => item.photo)].flatMap(place => place?.photo ? [[place.photo.imageSha256, place.photo]] : [])).values()];
  if (!photos.length) return '';
  return [...photos.map(photo => [photo.title && tr(photo.title), tr('사진: {0}', tr(photo.artist)), photo.sourceUrl, photo.license, photo.licenseUrl].filter(Boolean).join('\n')),
    tr('사진은 찍은 때의 모습이라 지금과 다를 수 있어요.')].join('\n');
}

/** Bottom sheet that previews the place or list card and shares it. The card colour is its own choice, apart from the app theme. */
export function ShareCardSheet({ target, visible, onClose }: { target: ShareCardTarget; visible: boolean; onClose: () => void }) {
  const { tr, language } = useLanguage(), { me, isAuthed } = useAuth(), { play } = useInteractionFeedback(), theme = useTheme();
  const reduced = useReducedMotion(), { height: screen } = useWindowDimensions();
  const [tone, setTone] = useState<ShareCardTone>('dark'), [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [account, setAccount] = useState<{ id: string; metadata: Record<string, unknown> } | null>(null);
  const view = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!visible || !isAuthed) return;
    let live = true;
    // The persona flag lives in app_metadata, which only the session carries.
    void supabase.auth.getSession().then(({ data }) => { if (live && data.session) setAccount({ id: data.session.user.id, metadata: data.session.user.app_metadata }); }).catch(() => {});
    return () => { live = false; };
  }, [visible, isAuthed]);
  const senderName = isAuthed && account?.id === me.id ? shareCardSenderName(me.nickname, account.metadata) : null;
  const sender = signed ? senderName : null;
  const card = target.kind === 'place' ? placeShareCard(target.place, target.city, language, sender) : listShareCard(target.name, target.places, target.count, language, sender);
  const width = Math.round(Math.min(260, Math.max(150, (screen * 0.92 - 360) * 9 / 16)));
  const credits = photoCredits(card, tr);
  async function share() {
    if (busy) return;
    setBusy(true); setNotice(''); play('selection');
    try { if (await exportShareCard(card, view)) play('message'); }
    catch { setNotice(tr('공유하지 못했어요. 다시 눌러주세요.')); play('warning'); }
    finally { setBusy(false); }
  }
  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={tr(target.kind === 'place' ? '장소 공유' : '목록 공유')}>
    <ScrollView analyticsId="share.card.scroll" contentContainerStyle={styles.content}>
      <Reanimated.View key={tone} entering={reduced ? FadeIn.duration(ControlMotion.settleMs) : FadeInDown.duration(ControlMotion.expandMs)}
        style={[styles.preview, { borderColor: theme.line }]}>
        <ShareCardView ref={view} card={card} tone={tone} width={width} />
      </Reanimated.View>
      {!!credits && <PostPhotoCredits credits={credits} />}
      <View accessibilityRole="radiogroup" accessibilityLabel={tr('카드 색')} style={styles.chips}>
        {([['dark', tr('어둡게')], ['light', tr('밝게')]] as const).map(([value, label]) => <SelectionChip key={value} analyticsId="share.card.tone" label={label}
          selected={tone === value} accessibilityRole="radio" aria-checked={tone === value} accessibilityState={{ selected: tone === value }}
          onPress={() => { play('selection'); setTone(value); }} />)}
      </View>
      {!!senderName && <View style={styles.option}>
        <View style={styles.optionText}>
          <ThemedText type="label">{tr('카드에 내 이름 넣기')}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={1}>{senderName}</ThemedText>
        </View>
        <Switch analyticsId="share.card.sender" accessibilityLabel={tr('카드에 내 이름 넣기')} value={signed} disabled={busy}
          onValueChange={value => { play('selection'); setSigned(value); }} />
      </View>}
      <RaisedActionButton analyticsId="share.card.export" label={tr(SHARE_CARD_ACTION)} busy={busy} onPress={() => void share()} />
      {!!notice && <ThemedText type="supporting" themeColor="textSecondary" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    </ScrollView>
  </DragSheet>;
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  glow: { position: 'absolute' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  badge: { maxWidth: '60%', borderRadius: 999 },
  fill: { flex: 1, minHeight: 0 },
  row: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'center' },
  thumb: { height: '100%', aspectRatio: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  rowName: { flex: 1 },
  content: { gap: Spacing.three, paddingBottom: Spacing.two },
  preview: { alignSelf: 'center', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  optionText: { flex: 1, gap: Spacing.half },
});

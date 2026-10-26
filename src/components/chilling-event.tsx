import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { memo, useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { PostShareSheet } from '@/components/post-share-sheet';
import { recordPostShare } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { chillingCountdown, chillingKind, chillingSchedule, recommendedAgeLabel, type ChillingKind, type ChillingSchedule, chillingTimezoneLabel } from '@/lib/chilling';
import { getPostImageSource } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { meetupFeeAmount, meetupFeeDue } from '@/lib/meetup-host-tools';
import type { Post, RoomPreview } from '@/lib/types';

export function ChillingKindTabs({ value, onChange }: { value: ChillingKind; onChange: (kind: ChillingKind) => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <View accessibilityRole="tablist" accessibilityLabel={tr("모임 종류")} style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
    {(['once', 'group'] as const).map(kind => <Pressable analyticsId="components_chilling-event.pressable.1" key={kind} accessibilityRole="tab" accessibilityState={{ selected: value === kind }} onPress={() => { play('selection'); onChange(kind); }} style={[styles.tab, value === kind && { backgroundColor: theme.background }]}><ThemedText type="smallBold">{kind === 'once' ? tr('칠링') : tr('정기모임')}</ThemedText></Pressable>)}
  </View>;
}

/** paid is the viewer's own mark; omit it for applicants and the public card. */
export function MeetupFeeLine({ fee, paid }: { fee: NonNullable<RoomPreview['fee']>; paid?: boolean | null }) {
  const { tr, locale: appLocale } = useLanguage();
  return <ThemedText type="small" style={styles.support} themeColor="textSecondary">{[tr('회비 {0}', meetupFeeAmount(fee.amount)), fee.note, fee.dueOn && tr('{0}까지', meetupFeeDue(fee.dueOn, appLocale)), paid == null ? '' : paid ? tr('냈음') : tr('아직 안 냈어요')].filter(Boolean).join(' · ')}</ThemedText>;
}

export function ChillingEventSchedule({ room }: { room: ChillingSchedule & Pick<RoomPreview, 'fee'> }) {
  const { tr, locale: appLocale } = useLanguage();
  const once = chillingKind(room) === 'once';
  return <View style={{ gap: 4 }}>
    <ThemedText type="smallBold" style={styles.support} themeColor="accent">{once ? tr('칠링') : tr('정기모임')}</ThemedText>
    <ThemedText style={styles.schedule}>{chillingSchedule(room, appLocale)}</ThemedText>
    <ThemedText type="small" style={styles.support} themeColor="textSecondary">{recommendedAgeLabel(room, appLocale)}{room.recommendedAgeMin != null ? tr(" · 권장 범위 밖이어도 신청 가능") : ''}</ThemedText>
    {once && room.timezone ? <ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr("{0} 기준", chillingTimezoneLabel(room, appLocale))}</ThemedText> : null}
    {room.fee ? <MeetupFeeLine fee={room.fee} /> : null}
  </View>;
}

export const CHILLING_CATEGORY_LABELS = { casual: '가볍게', party: '파티', festival: '페스티벌', sports: '스포츠', hobby: '취미', travel: '여행' } as const;

export function SeatBar({ room }: { room: Pick<RoomPreview, 'memberCount' | 'capacity'> }) {
  const theme = useTheme();
  if (!room.capacity) return null;
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    style={[styles.seat, { backgroundColor: theme.backgroundElement }]}>
    <View style={[styles.seatFill, { width: `${Math.min(100, Math.round(((room.memberCount ?? 0) / room.capacity) * 100))}%`, backgroundColor: room.memberCount >= room.capacity ? theme.textSecondary : theme.navy }]} />
  </View>;
}

export const ChillingEvent = memo(function ChillingEvent({ post, city, onOpen, onAuthor }: {
  post: Post; city: string; onOpen: () => void; onAuthor: () => void;
}) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { me, isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const [report, setReport] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState<string>();
  const source = getPostImageSource(post, isAuthed ? me.id : 'guest');
  const group = chillingKind(post.room ?? {}) === 'group';
  const countdown = chillingCountdown(post.room ?? {}, undefined, appLocale);
  const room = post.room;
  const schedule = chillingSchedule(post.room ?? {}, appLocale);
  const categoryLabel = room?.category ? tr(CHILLING_CATEGORY_LABELS[room.category]) : null;
  const seatsLeft = room?.capacity ? Math.max(0, room.capacity - room.memberCount) : null;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Pressable analyticsId="components_chilling-event.pressable.2" onPress={() => { play('selection'); onOpen(); }} accessibilityRole="button" accessibilityLabel={`${post.title}, ${schedule}${room?.fee ? `, ${tr('회비 {0}', meetupFeeAmount(room.fee.amount))}` : ''}${room?.recruitingClosed ? `, ${tr('모집 마감')}` : ''}`} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {source && source.uri !== failed ? <Image source={source} style={styles.photo} contentFit="cover" recyclingKey={post.id} onError={() => setFailed(source.uri)} /> :
        // Decorative only: the title right below already names the meetup.
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.poster, { backgroundColor: theme.card }]}>
          <View style={[styles.sun, { backgroundColor: theme.accent }]} />
          <View style={[styles.wave, { backgroundColor: theme.backgroundSelected }]} />
        </View>}
      <View style={styles.copy}>
      <View style={styles.meta}>
        {countdown && <View style={[styles.countdown, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={[styles.support, { color: theme.accentInk }]}>{countdown}</ThemedText></View>}
        <ThemedText type="smallBold" style={styles.support} themeColor="accent">{categoryLabel ? `${categoryLabel} · ` : ''}{group ? tr('정기모임') : tr('칠링')}</ThemedText>
        {room?.recruitingClosed && <View style={[styles.countdown, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" style={styles.support} themeColor="textSecondary">{tr('모집 마감')}</ThemedText></View>}
      </View>
      <ThemedText accessibilityRole="header" style={styles.title}>{post.title}</ThemedText>
      <ThemedText style={styles.schedule}>{schedule}</ThemedText>
      <ThemedText type="small" style={styles.support} themeColor="textSecondary">{recommendedAgeLabel(post.room ?? {}, appLocale)}</ThemedText>
      {room?.fee ? <MeetupFeeLine fee={room.fee} /> : null}
      <View style={styles.footer}>
        <ThemedText type="small" style={styles.support} themeColor="textSecondary">{city}</ThemedText>
        <ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr(post.room?.capacity ? "{0} / {1}명" : "{0}명", post.room?.memberCount ?? 0, post.room?.capacity)}{seatsLeft !== null ? seatsLeft > 0 ? tr(" · {0}자리 남음", (seatsLeft)) : tr(" · 정원 마감") : ''}</ThemedText>
      </View>
      {/* 자리 현황은 숫자보다 막대가 먼저 읽힌다(정원이 있는 모임만). */}
      {room ? <SeatBar room={room} /> : null}
      </View>
    </Pressable>
    <View style={[styles.footer, styles.cardActions, { borderTopColor: theme.line }]}>
      <Pressable analyticsId="components_chilling-event.pressable.3" onPress={() => { play('selection'); onAuthor(); }} accessibilityRole="button" accessibilityLabel={tr("{0} 프로필", (post.author.nickname))} style={styles.author}><TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} /><ThemedText type="small" style={[styles.support, styles.flex]} themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{tr("{0}님이 열었어요 ›", post.author.nickname)}</ThemedText></Pressable>
      <Pressable analyticsId="meetup.share.open" accessibilityRole="button" accessibilityLabel={post.author.id === me.id ? tr("내 모임에 초대하기") : tr("모임 공유하기")} style={styles.action}
        onPress={() => { play('selection'); if (isAuthed) setSharing(true); else promptLogin('모임을 공유하려면 로그인해주세요.'); }}><ThemedText style={styles.schedule} themeColor="accent">{post.author.id === me.id ? tr("초대") : tr("공유")}</ThemedText></Pressable>
      {post.author.id !== me.id && <Pressable analyticsId="components_chilling-event.pressable.4" accessibilityRole="button" accessibilityLabel={tr("신고 및 차단")} style={styles.action} onPress={() => { play('selection'); if (isAuthed) setReport(true); else promptLogin('신고하려면 로그인해 주세요.'); }}><ThemedText style={{ color: theme.textSecondary }}>···</ThemedText></Pressable>}
    </View>
    <ReportSheet visible={report} targetType="post" targetId={post.id} reportedUserId={post.business ? undefined : post.author.id} reportedBusinessId={post.business?.id} reportedNickname={post.business?.name ?? post.author.nickname} onClose={() => setReport(false)} />
    {sharing && <PostShareSheet post={post} visible={sharing} onClose={() => setSharing(false)} onShared={() => { void recordPostShare(supabase, post.id).catch(() => {}); }} />}
  </View>;
});

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12 },
  tab: { flex: 1, minHeight: 44, borderRadius: 9, padding: 4, alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 24, borderWidth: 1, borderRadius: 20, overflow: 'hidden' }, photo: { width: '100%', height: 200 },
  copy: { padding: 16, gap: 8 }, cardActions: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 4 },
  poster: { height: 120, overflow: 'hidden' },
  sun: { position: 'absolute', width: 84, height: 84, borderRadius: 42, right: 24, top: 18 },
  wave: { position: 'absolute', width: 390, height: 110, borderRadius: 195, right: -80, bottom: -38, transform: [{ rotate: '-15deg' }] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  countdown: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  title: { fontSize: 20, fontWeight: '700', lineHeight: 28 },
  schedule: { fontSize: 16, lineHeight: 24 }, support: { fontSize: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  seat: { height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 8 }, seatFill: { height: '100%', borderRadius: 999 },
  flex: { flex: 1, minWidth: 0 }, author: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }, action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});

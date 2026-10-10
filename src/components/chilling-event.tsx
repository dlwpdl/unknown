import { Pressable } from '@/components/analytics-controls';
import { memo, useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { chillingCountdown, chillingKind, chillingSchedule, recommendedAgeLabel, type ChillingKind, type ChillingSchedule } from '@/lib/chilling';
import { getPostImageSource } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { Post } from '@/lib/types';

export function ChillingKindTabs({ value, onChange }: { value: ChillingKind; onChange: (kind: ChillingKind) => void }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <View accessibilityRole="tablist" accessibilityLabel="만남 유형" style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
    {(['once', 'group'] as const).map(kind => <Pressable analyticsId="components_chilling-event.pressable.1" key={kind} accessibilityRole="tab" accessibilityState={{ selected: value === kind }} onPress={() => { play('selection'); onChange(kind); }} style={[styles.tab, value === kind && { backgroundColor: theme.background }]}><ThemedText type="smallBold">{kind === 'once' ? '칠링 (일회성)' : '모임 (정기모임)'}</ThemedText></Pressable>)}
  </View>;
}

export function ChillingEventSchedule({ room }: { room: ChillingSchedule }) {
  const once = chillingKind(room) === 'once';
  return <View style={{ gap: 4 }}>
    <ThemedText type="smallBold" themeColor="accent">{once ? '칠링 · 일회성' : '모임 · 정기모임'}</ThemedText>
    <ThemedText type="small">{chillingSchedule(room)}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{recommendedAgeLabel(room)}{room.recommendedAgeMin != null ? ' · 권장 범위 밖이어도 신청 가능' : ''}</ThemedText>
    {once && room.timezone ? <ThemedText type="small" themeColor="textSecondary">{room.timezone} 기준</ThemedText> : null}
  </View>;
}

export const ChillingEvent = memo(function ChillingEvent({ post, city, onOpen, onAuthor }: {
  post: Post; city: string; onOpen: () => void; onAuthor: () => void;
}) {
  const theme = useTheme();
  const { me, isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const [report, setReport] = useState(false);
  const [failed, setFailed] = useState<string>();
  const source = getPostImageSource(post, isAuthed ? me.id : 'guest');
  const group = chillingKind(post.room ?? {}) === 'group';
  const countdown = chillingCountdown(post.room ?? {});
  const room = post.room;
  const schedule = chillingSchedule(post.room ?? {});
  const categoryLabel = room?.category && { casual: '가볍게', party: '파티', festival: '페스티벌', sports: '스포츠', hobby: '취미', travel: '여행' }[room.category];
  const seatsLeft = room?.capacity ? Math.max(0, room.capacity - room.memberCount) : null;
  return <View style={styles.card}>
    <Pressable analyticsId="components_chilling-event.pressable.2" onPress={() => { play('selection'); onOpen(); }} accessibilityRole="button" accessibilityLabel={`${post.title}, ${schedule}`} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {source && source.uri !== failed ? <Image source={source} style={styles.photo} contentFit="cover" recyclingKey={post.id} onError={() => setFailed(source.uri)} /> :
        <View style={[styles.poster, { backgroundColor: theme.card }]}>
          <View style={[styles.sun, { backgroundColor: theme.accent }]} />
          <View style={[styles.wave, { backgroundColor: theme.backgroundSelected }]} />
          <ThemedText style={styles.artSmall}>{group ? 'GOOD COMPANY, AGAIN.' : 'A LITTLE TIME TOGETHER.'}</ThemedText>
          <ThemedText style={styles.artTitle}>{post.title}</ThemedText>
        </View>}
      <View style={styles.meta}>
        {countdown && <View style={[styles.countdown, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{countdown}</ThemedText></View>}
        <ThemedText type="smallBold" themeColor="accent">{categoryLabel ? `${categoryLabel} · ` : ''}{group ? '모임 · 정기모임' : '칠링 · 일회성'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{schedule}</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">{recommendedAgeLabel(post.room ?? {})}</ThemedText>
      <ThemedText accessibilityRole="header" style={styles.title}>{post.title}</ThemedText>
      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary">{city}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{post.room?.memberCount ?? 0}{post.room?.capacity ? ` / ${post.room.capacity}명` : '명'}{seatsLeft !== null ? seatsLeft > 0 ? ` · ${seatsLeft}자리 남음` : ' · 정원 마감' : ''}</ThemedText>
      </View>
      {/* 자리 현황은 숫자보다 막대가 먼저 읽힌다(정원이 있는 모임만). */}
      {room?.capacity ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
        style={[styles.seat, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.seatFill, { width: `${Math.min(100, Math.round(((room.memberCount ?? 0) / room.capacity) * 100))}%`, backgroundColor: seatsLeft === 0 ? theme.textSecondary : theme.navy }]} />
      </View> : null}
    </Pressable>
    <View style={styles.footer}>
      <Pressable analyticsId="components_chilling-event.pressable.3" onPress={() => { play('selection'); onAuthor(); }} accessibilityRole="button" accessibilityLabel={`${post.author.nickname} 프로필`} style={styles.author}><TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} /><ThemedText type="small" themeColor="textSecondary">{post.author.nickname}님이 열었어요 ›</ThemedText></Pressable>
      {post.author.id !== me.id && <Pressable analyticsId="components_chilling-event.pressable.4" accessibilityRole="button" accessibilityLabel="신고 및 차단" style={styles.action} onPress={() => { play('selection'); if (isAuthed) setReport(true); else promptLogin('신고하려면 로그인해 주세요.'); }}><ThemedText style={{ color: theme.textSecondary }}>···</ThemedText></Pressable>}
    </View>
    <ReportSheet visible={report} targetType="post" targetId={post.id} reportedUserId={post.author.id} reportedNickname={post.author.nickname} onClose={() => setReport(false)} />
  </View>;
});

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12 },
  tab: { flex: 1, minHeight: 44, borderRadius: 9, padding: 4, alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 24 }, photo: { width: '100%', height: 200, borderRadius: 16 },
  poster: { minHeight: 200, borderRadius: 16, padding: 24, overflow: 'hidden', justifyContent: 'space-between', gap: 28 },
  sun: { position: 'absolute', width: 114, height: 114, borderRadius: 57, right: 20, top: 28 },
  wave: { position: 'absolute', width: 390, height: 110, borderRadius: 195, right: -80, bottom: -38, transform: [{ rotate: '-15deg' }] },
  artSmall: { color: '#CBB9FF', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  artTitle: { color: '#F6F3F0', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1, paddingRight: 28 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 6 },
  countdown: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  title: { fontSize: 19, fontWeight: '700', lineHeight: 27, marginBottom: 6 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  seat: { height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 8 }, seatFill: { height: '100%', borderRadius: 999 },
  author: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }, action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});

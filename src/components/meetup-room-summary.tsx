import { useLanguage } from '@/hooks/use-language';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import type { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { ThemedText } from '@/components/themed-text';
import { IconSize, ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { chillingSchedule } from '@/lib/chilling';
import { getChillingError, setMeetupRecruiting } from '@/lib/chilling-data';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { loadPublicMeetupContext, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import type { RoomPreview } from '@/lib/types';

type ManageAction = Parameters<typeof MeetupManageSheet>[0]['actions'][number];
type Tr = ReturnType<typeof useLanguage>['tr'];

/** 모임장 관리 시트에 넣는 모집 마감/재개·정보 수정. 내 모임 ⋯ 메뉴와 모임 대화의 관리 시트가 함께 쓴다. */
export function meetupHostActions({ postId, room, tr, play, router, onChanged }: {
  postId: string; room: Pick<RoomPreview, 'closed' | 'recruitingClosed'>; tr: Tr; play: ReturnType<typeof useInteractionFeedback>['play'];
  router: Pick<ReturnType<typeof useRouter>, 'push'>; onChanged?: () => void;
}): ManageAction[] {
  if (room.closed) return [];
  const paused = room.recruitingClosed === true;
  const run = async () => {
    try {
      await setMeetupRecruiting(supabase, postId, paused);
      play('success'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT); onChanged?.();
    } catch (failure) {
      play('warning');
      const title = tr('모집 상태를 바꾸지 못했어요'), body = getChillingError(failure);
      // react-native-web's Alert.alert is a no-op.
      if (Platform.OS === 'web') globalThis.alert(`${title}\n${body}`); else Alert.alert(title, body);
    }
  };
  const toggle = () => {
    if (paused) { void run(); return; }
    const title = tr('모집을 마감할까요?'), body = tr('새 참여 신청만 받지 않아요. 지금 멤버와 대기 중인 신청은 그대로 남고, 언제든 다시 열 수 있어요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${body}`)) void run(); }
    else Alert.alert(title, body, [{ text: tr('돌아가기'), style: 'cancel' }, { text: tr('모집 마감하기'), onPress: () => void run() }]);
  };
  return [
    { key: 'edit', analyticsId: 'meetup.manage.edit', label: tr('모임 정보 수정'), icon: { ios: 'pencil', android: 'edit', web: 'edit' }, onPress: () => router.push({ pathname: '/meetup-edit', params: { postId } }) },
    { key: 'recruiting', analyticsId: 'meetup.manage.recruiting', label: paused ? tr('모집 다시 열기') : tr('모집 마감하기'), hint: paused ? tr('새 참여 신청을 다시 받아요') : tr('멤버와 대기 중인 신청은 그대로예요'),
      icon: paused ? { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' } : { ios: 'pause.circle', android: 'pause_circle', web: 'pause_circle' }, onPress: toggle },
  ];
}

/** 승인 직전 고르는 대화 기록 공개 범위. 기본은 승인 이후 대화만. */
export function MeetupHistoryChoice({ value, onChange, disabled }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <Pressable analyticsId="meetup.request.history" accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled: !!disabled }} aria-checked={value} disabled={disabled}
    onPress={() => { play('selection'); onChange(!value); }} style={({ pressed }) => [styles.choice, { opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.checkbox, { borderColor: value ? theme.accent : theme.line, backgroundColor: value ? theme.accent : theme.card }]}>
      {value && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.chevron} tintColor={theme.accentInk} />}
    </View>
    <View style={styles.body}>
      <ThemedText type="smallBold">{tr('이전 대화도 보여주기')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr('켜면 승인 전 대화도 볼 수 있어요. 끄면 승인 이후 대화부터 보여요.')}</ThemedText>
    </View>
  </Pressable>;
}

/** 모임 대화 위에 붙는 요약 카드. 일정·인원은 모임 글에서 읽는다. */
/** onManage receives the host recruiting/edit actions built from the loaded room so the caller's 모임 관리 sheet can list them. */
export function MeetupRoomSummary({ postId, onOpen, onManage }: { postId: string; onOpen: () => void; onManage?: (hostActions: ManageAction[]) => void }) {
  const { tr, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const router = useRouter();
  const [post, setPost] = useState<PublicMeetupContext | null>(null), [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? loadPublicMeetupContext(supabase, postId) : null).then(value => { if (active) setPost(value); }).catch(() => {});
    return () => { active = false; };
  }, [postId, version]);
  const room = post?.room;
  const schedule = room ? chillingSchedule(room, appLocale) : null;
  const count = room ? (room.capacity != null ? tr('{0}/{1}명', room.memberCount, room.capacity) : tr('{0}명', room.memberCount)) + (room.recruitingClosed ? tr(' · 모집 마감') : '') : null;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Pressable analyticsId="chat.meetup-summary" accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Open meetup overview' : '모임 현황 열기'}
    onPress={() => { play('selection'); onOpen(); }}
    style={({ pressed }) => [styles.open, { opacity: pressed ? 0.82 : 1 }]}>
    <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'sun.horizon', android: 'wb_twilight', web: 'wb_twilight' }} size={IconSize.toolbar} tintColor={theme.accent} />
    </View>
    <View style={styles.body}>
      <ThemedText type="smallBold" numberOfLines={2}>{post?.title ?? tr('모임')}</ThemedText>
      {!!schedule && <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>{schedule}</ThemedText>}
      {!!count && <ThemedText type="small" themeColor="textSecondary">{count}</ThemedText>}
    </View>
    <View style={ControlStyles.icon}>
      <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
    </View>
    </Pressable>
    {onManage && <Pressable analyticsId="chat.meetup-manage" accessibilityRole="button" accessibilityLabel={tr('모임 관리')}
      onPress={() => { play('selection'); onManage(room ? meetupHostActions({ postId, room, tr, play, router, onChanged: () => setVersion(value => value + 1) }) : []); }} style={({ pressed }) => [styles.manage, { borderTopColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
      <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={IconSize.inline} tintColor={theme.accent} />
      <ThemedText type="smallBold" themeColor="accent">{tr('모임 관리')}</ThemedText>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: Spacing.three, marginTop: Spacing.three, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  open: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, paddingLeft: Spacing.three },
  manage: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.two },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { marginTop: 2 },
});

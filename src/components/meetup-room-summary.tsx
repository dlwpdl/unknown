import { useLanguage } from '@/hooks/use-language';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { IconSize, ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { chillingSchedule } from '@/lib/chilling';
import { loadPublicMeetupContext, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

/** 모임 대화 위에 붙는 요약 카드. 일정·인원은 모임 글에서 읽는다. */
export function MeetupRoomSummary({ postId, onOpen, onManage }: { postId: string; onOpen: () => void; onManage?: () => void }) {
  const { tr, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [post, setPost] = useState<PublicMeetupContext | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? loadPublicMeetupContext(supabase, postId) : null).then(value => { if (active) setPost(value); }).catch(() => {});
    return () => { active = false; };
  }, [postId]);
  const room = post?.room;
  const meta = [room ? chillingSchedule(room, appLocale) : null,
    room?.capacity != null ? tr('{0}/{1}명', room.memberCount, room.capacity) : room ? tr('{0}명', room.memberCount) : null]
    .filter(Boolean).join(' · ');
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Pressable analyticsId="chat.meetup-summary" accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Open meetup overview' : '모임 현황 열기'}
    onPress={() => { play('selection'); onOpen(); }}
    style={({ pressed }) => [styles.open, { opacity: pressed ? 0.82 : 1 }]}>
    <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'sun.horizon', android: 'wb_twilight', web: 'wb_twilight' }} size={IconSize.toolbar} tintColor={theme.accent} />
    </View>
    <View style={styles.body}>
      <ThemedText type="smallBold" numberOfLines={2}>{post?.title ?? tr('모임')}</ThemedText>
      {!!meta && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.meta}>{meta}</ThemedText>}
    </View>
    <View style={ControlStyles.icon}>
      <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
    </View>
    </Pressable>
    {onManage && <Pressable analyticsId="chat.meetup-manage" accessibilityRole="button" accessibilityLabel={tr('모임 관리')}
      onPress={() => { play('selection'); onManage(); }} style={({ pressed }) => [styles.manage, { borderTopColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
      <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={IconSize.inline} tintColor={theme.accent} />
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
  meta: { marginTop: 2 },
});

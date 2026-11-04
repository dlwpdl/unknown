import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { ThemedText } from '@/components/themed-text';
import { IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { FriendSavedPlace, MapScope } from '@/lib/profile-friends';

// 지도 '보여 줄 곳' (owner 2026-11-04, 리디자인 4단계). '내 취향'·'모임 열린 곳' come with a later stage.
export const MAP_SCOPES = [
  { id: 'all', label: '모두', icon: { ios: 'globe', android: 'public', web: 'public' } },
  { id: 'mine', label: '내가 저장한 곳', icon: { ios: 'bookmark', android: 'bookmark', web: 'bookmark' } },
  { id: 'friends', label: '친구가 저장한 곳', icon: { ios: 'person.2', android: 'group', web: 'group' } },
] as const;

// One choice applies at once and closes the sheet, like an iOS menu; the category, open-now and price filters keep working inside it.
export function MapScopeSheet({ visible, scope, onClose, onPick }: { visible: boolean; scope: MapScope; onClose: () => void; onPick: (scope: MapScope) => void }) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  return <DragSheet visible={visible} onClose={onClose} title={tr('보여 줄 곳')}>
    <View accessibilityRole="radiogroup" style={styles.options}>
      {MAP_SCOPES.map(option => {
        const selected = option.id === scope;
        return <Pressable key={option.id} analyticsId={`discovery.scope.${option.id}`} accessibilityRole="radio" accessibilityState={{ checked: selected, selected }}
          accessibilityLabel={tr(option.label)} onPress={() => { play('selection'); onPick(option.id); }}
          style={({ pressed }) => [styles.option, { borderBottomColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={option.icon} size={IconSize.toolbar} tintColor={selected ? theme.accent : theme.textSecondary} />
          <ThemedText type="smallBold" style={[styles.flex, selected && { color: theme.accent }]}>{tr(option.label)}</ThemedText>
          {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.inline} tintColor={theme.accent} />}
        </Pressable>;
      })}
    </View>
  </DragSheet>;
}

// "하늘님이 저장" / "하늘님 외 2명이 저장", with up to three faces (photo, or the first letter when there is none).
export function FriendSavedLine({ entry }: { entry: FriendSavedPlace }) {
  const { tr } = useLanguage(), theme = useTheme();
  const first = entry.friends[0];
  if (!first) return null;
  const label = entry.friendCount > 1 ? tr('{0}님 외 {1}명이 저장', first.nickname, entry.friendCount - 1) : tr('{0}님이 저장', first.nickname);
  return <View accessible accessibilityLabel={label} style={styles.saved}>
    <View style={styles.faces}>{entry.friends.map((friend, index) =>
      <View key={friend.id} style={[styles.face, { marginLeft: index ? -6 : 0, borderColor: theme.card, backgroundColor: theme.backgroundSelected }]}>
        {friend.avatarUrl ? <Image source={{ uri: friend.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
          : <ThemedText style={[Typography.micro, { color: theme.accent }]}>{[...friend.nickname][0] ?? ''}</ThemedText>}
      </View>)}</View>
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>{label}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  options: { paddingBottom: Spacing.two },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0 },
  saved: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  faces: { flexDirection: 'row' },
  face: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});

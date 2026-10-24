import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ADMIN_NAV_GROUPS, ADMIN_SECTIONS, type AdminSection } from '@/lib/admin';
import { displayName } from '@/lib/admin-labels';
import { ACCOUNT_TYPES, EMPTY_DIRECTORY_FILTERS, searchAdminUsers, type AdminDirectoryProfile } from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';

type Item =
  | { kind: 'section'; id: AdminSection; label: string; hint: string }
  | { kind: 'member'; id: string; label: string; hint: string };

/** ⌘K / Ctrl+K: 섹션 이동과 회원 찾기를 한 곳에서. 폰에서는 선택기 안의 "검색"으로도 열린다. */
export function AdminCommandPalette({
  visible,
  localPreview,
  onClose,
  onSection,
  onUser,
}: {
  visible: boolean;
  localPreview?: boolean;
  onClose: () => void;
  onSection: (section: AdminSection) => void;
  onUser: (userId: string) => void;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<AdminDirectoryProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible || localPreview) return;
    const needle = query.trim();
    if (needle.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchAdminUsers(supabase, needle, 0, EMPTY_DIRECTORY_FILTERS)
        .then((result) => { if (active) setMembers(result.rows.slice(0, 6)); })
        .catch(() => { if (active) setMembers([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, visible, localPreview]);

  const needle = query.trim().toLocaleLowerCase('ko-KR');
  const sectionItems: Item[] = ADMIN_SECTIONS
    .filter((section) => !needle || section.label.toLocaleLowerCase('ko-KR').includes(needle))
    .map((section) => ({
      kind: 'section' as const,
      id: section.id,
      label: section.label,
      hint: ADMIN_NAV_GROUPS.find((group) => group.sections.includes(section.id))?.label ?? '이동',
    }));
  const memberItems: Item[] = (needle.length >= 2 ? members : []).map((member) => ({
    kind: 'member' as const,
    id: member.id,
    label: displayName(member, member.id),
    hint: [member.email ?? '이메일 미제공', ACCOUNT_TYPES[member.account_type], member.account_status === 'active' ? null : '정상 아님'].filter(Boolean).join(' · '),
  }));
  const items = [...sectionItems, ...memberItems];
  const active = Math.min(cursor, Math.max(0, items.length - 1));

  const run = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'section') onSection(item.id);
    else onUser(item.id);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="검색 닫기" style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => { play('selection'); onClose(); }} />
      <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="화면·회원 검색">
        <TextInput
          ref={inputRef}
          autoFocus
          value={query}
          onChangeText={(value) => { setQuery(value); setCursor(0); }}
          onSubmitEditing={() => run(items[active])}
          onKeyPress={(event) => {
            const key = (event.nativeEvent as { key?: string }).key;
            if (key === 'ArrowDown') { event.preventDefault?.(); setCursor((value) => Math.min(value + 1, items.length - 1)); }
            if (key === 'ArrowUp') { event.preventDefault?.(); setCursor((value) => Math.max(0, value - 1)); }
          }}
          placeholder="화면 이름 또는 회원(닉네임·이메일) 검색"
          placeholderTextColor={Colors.admin.textSecondary}
          accessibilityLabel="화면 또는 회원 검색"
          returnKeyType="go"
          style={styles.input}
        />
        <View style={styles.list}>
          {items.length === 0 && <ThemedText type="small" style={styles.muted}>{searching && needle.length >= 2 ? '검색 중…' : query.trim().length === 1 ? '두 글자부터 회원을 찾습니다.' : '결과가 없습니다.'}</ThemedText>}
          {items.map((item, index) => (
            <Pressable
              key={`${item.kind}:${item.id}`}
              accessibilityRole="menuitem"
              onPress={() => { play('selection'); return run(item); }}
              onHoverIn={() => setCursor(index)}
              style={({ pressed }) => [styles.row, index === active && styles.rowActive, pressed && styles.pressed]}>
              <ThemedText type="smallBold">{item.label}</ThemedText>
              <ThemedText type="small" style={styles.muted}>{item.hint}</ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.footer}>
          <ThemedText type="small" style={styles.muted}>↑↓ 이동 · Enter 열기 · Esc 닫기{localPreview ? ' · 미리보기에서는 회원 검색을 쓰지 않습니다' : ''}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => { play('selection'); onClose(); }} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <ThemedText type="smallBold">닫기</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#25263166' },
  sheet: { width: 560, maxWidth: '92%', maxHeight: '80%', alignSelf: 'center', marginTop: '12%', padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 12, backgroundColor: Colors.admin.card },
  input: { minHeight: 48, paddingHorizontal: Spacing.three, color: Colors.admin.text, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.background },
  list: { gap: Spacing.one },
  row: { minHeight: 48, justifyContent: 'center', gap: 2, paddingHorizontal: Spacing.three, borderRadius: 8 },
  rowActive: { backgroundColor: Colors.admin.backgroundElement },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  close: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8 },
  muted: { color: Colors.admin.textSecondary },
  pressed: { opacity: 0.7 },
});

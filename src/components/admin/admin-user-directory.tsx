import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminDashboardData } from '@/lib/admin-data';
import { ACCOUNT_TYPES, searchAdminUsers, type AdminUserDirectory } from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';

export function AdminUserDirectoryPanel({ onUser, refreshData }: { onUser: (id: string) => void; refreshData: AdminDashboardData }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{ key: string; source: AdminDashboardData; data: AdminUserDirectory | null; error: string | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  const requestKey = `${query}:${retry}`;
  const current = response?.key === requestKey && response.source === refreshData ? response : null;
  const result = current?.data ?? null;
  const error = current?.error ?? null;
  const busy = !current || moreBusy;
  useEffect(() => {
    const id = ++revision.current;
    void searchAdminUsers(supabase, query).then((data) => { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data, error: null }); })
      .catch(() => { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: null, error: '회원 정보를 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요.' }); })
      .finally(() => { if (id === revision.current) setMoreBusy(false); });
    return () => { revision.current = id + 1; };
  }, [query, refreshData, requestKey]);
  const more = async () => {
    if (!result || busy) return;
    const id = revision.current;
    setMoreBusy(true);
    try {
      const next = await searchAdminUsers(supabase, query, result.rows.length);
      if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: { ...next, rows: [...new Map([...result.rows, ...next.rows].map((row) => [row.id, row])).values()] }, error: null });
    } catch { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: result, error: '다음 회원 목록을 불러오지 못했습니다.' }); }
    finally { if (id === revision.current) setMoreBusy(false); }
  };
  const search = () => { setQuery(input.trim()); setRetry((value) => value + 1); };
  return <View style={styles.section}>
    <ThemedText type="title" accessibilityRole="header">사용자</ThemedText>
    <ThemedText style={styles.muted}>닉네임·이메일·로그인 프로필 이름·회원 ID로 전체 회원을 검색합니다.</ThemedText>
    {result && <ThemedText selectable type="small">현재 관리자 · {result.viewer.email ?? result.viewer.id} · {result.viewer.role}</ThemedText>}
    <View style={styles.searchRow}>
      <TextInput value={input} onChangeText={setInput} maxLength={200} placeholder="닉네임, 이메일, 이름 또는 회원 ID" accessibilityLabel="전체 회원 검색" autoCapitalize="none" returnKeyType="search" onSubmitEditing={search} style={styles.input} />
      <Pressable onPress={search} accessibilityRole="button" style={styles.button}><ThemedText>검색</ThemedText></Pressable>
    </View>
    {error && <View accessibilityRole="alert"><ThemedText style={styles.error}>{error}</ThemedText><Pressable onPress={() => setRetry((value) => value + 1)} accessibilityRole="button" style={styles.button}><ThemedText>다시 시도</ThemedText></Pressable></View>}
    {busy && !result && <ThemedText accessibilityRole="progressbar">회원 정보를 불러오는 중입니다.</ThemedText>}
    {result && <>
      <ThemedText type="small" style={styles.muted}>검색 결과 {result.total}명 · {result.rows.length}명 표시 · 이름은 실명인증 정보가 아닙니다.</ThemedText>
      <View style={styles.rows}>{result.rows.map((profile) => <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`${profile.nickname}, ${profile.email ?? '이메일 미제공'}, 상세 활동 보기`} onPress={() => onUser(profile.id)} style={styles.row}>
        <View style={styles.identity}><ThemedText type="smallBold">{profile.nickname} · {ACCOUNT_TYPES[profile.account_type]}</ThemedText>
          <ThemedText>{profile.login_name ?? '이름 미제공'}</ThemedText>
          <ThemedText style={styles.muted}>{profile.email ?? '이메일 미제공'}</ThemedText>
          <ThemedText type="small" style={styles.muted}>{profile.providers.join(' · ') || '연결 공급자 없음'} · {profile.city_id ?? '지역 없음'}</ThemedText>
          <ThemedText type="small" style={styles.id}>{profile.id}</ThemedText></View>
        <ThemedText accessibilityElementsHidden>›</ThemedText>
      </Pressable>)}</View>
      {result.total === 0 && <ThemedText>일치하는 회원이 없습니다.</ThemedText>}
      {result.rows.length < result.total && <Pressable disabled={busy} onPress={() => void more()} accessibilityRole="button" style={styles.button}><ThemedText>{busy ? '불러오는 중' : '회원 더 보기'}</ThemedText></Pressable>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three }, muted: { color: Colors.light.textSecondary }, error: { color: Colors.light.accent },
  searchRow: { flexDirection: 'row', gap: Spacing.two },
  input: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, color: Colors.light.text, backgroundColor: Colors.light.card },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  rows: { borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.light.line, backgroundColor: Colors.light.card },
  identity: { flex: 1, minWidth: 0, gap: 2 }, id: { color: Colors.light.textSecondary, fontFamily: 'monospace', fontSize: 11 },
});

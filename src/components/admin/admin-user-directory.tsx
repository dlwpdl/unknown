import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminDashboardData } from '@/lib/admin-data';
import { ACCOUNT_TYPES, searchAdminUsers, type AdminUserDirectory } from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';
import { CITIES } from '@/lib/mock';

export function AdminUserDirectoryPanel({ onUser, refreshData }: { onUser: (id: string) => void; refreshData: AdminDashboardData }) {
  const compact = useWindowDimensions().width < 1000;
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
    <View style={styles.heading}>
      <ThemedText type="title" accessibilityRole="header" style={styles.title}>사용자</ThemedText>
      <ThemedText type="small" style={styles.muted}>닉네임·이메일·입력한 이름·로그인 프로필 이름·회원 ID로 전체 회원을 검색합니다.</ThemedText>
    </View>
    {result && <View style={styles.viewer}><ThemedText selectable type="small" style={styles.muted}>현재 관리자 · {result.viewer.email ?? result.viewer.id} · {result.viewer.role}</ThemedText></View>}
    <View style={styles.searchRow}>
      <TextInput value={input} onChangeText={setInput} maxLength={200} placeholder="닉네임, 이메일, 이름 또는 회원 ID" placeholderTextColor={Colors.light.textSecondary} accessibilityLabel="전체 회원 검색" autoCapitalize="none" returnKeyType="search" onSubmitEditing={search} style={styles.input} />
      <Pressable onPress={search} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.searchButton, pressed && styles.pressed]}><ThemedText type="smallBold" style={styles.searchText}>검색</ThemedText></Pressable>
    </View>
    {error && <View accessibilityRole="alert" style={styles.heading}><ThemedText style={styles.error}>{error}</ThemedText><Pressable onPress={() => setRetry((value) => value + 1)} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]}><ThemedText>다시 시도</ThemedText></Pressable></View>}
    {busy && !result && <ThemedText accessibilityRole="progressbar">회원 정보를 불러오는 중입니다.</ThemedText>}
    {result && <>
      <ThemedText type="small" style={styles.muted}>검색 결과 {result.total}명 · {result.rows.length}명 표시 · 이름은 실명인증 정보가 아닙니다.</ThemedText>
      <View style={styles.rows}>
        {!compact && <View style={styles.tableHeading} aria-hidden><ThemedText type="small" style={[styles.identity, styles.muted]}>회원 · ID</ThemedText><ThemedText type="small" style={[styles.login, styles.muted]}>로그인 정보</ThemedText><ThemedText type="small" style={[styles.region, styles.muted]}>선호 지역 · 계정 유형</ThemedText><View style={styles.chevronSpace} /></View>}
        {result.rows.map((profile, index) => <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`${profile.nickname}, ${profile.email ?? '이메일 미제공'}, 상세 활동 보기`} onPress={() => onUser(profile.id)} style={({ pressed }) => [styles.row, index === result.rows.length - 1 && styles.lastRow, pressed && styles.rowPressed]}>
        <View style={[styles.rowContent, compact && styles.rowContentCompact]}>
          <View style={styles.identity}>
            <ThemedText type="smallBold">{profile.nickname}</ThemedText>
            <ThemedText type="small">{profile.full_name ?? '입력 이름 미제공'}</ThemedText>
            <ThemedText type="small" style={styles.muted}>{profile.date_of_birth ? `${profile.date_of_birth}${profile.age != null ? ` · 만 ${profile.age}세` : ''}` : '생년월일 미제공'}</ThemedText>
            <ThemedText type="small" style={styles.id}>{profile.id}</ThemedText>
          </View>
          <View style={styles.login}>
            <ThemedText type="small">로그인 이름 · {profile.login_name ?? '미제공'}</ThemedText>
            <ThemedText type="small" style={styles.muted}>{profile.providers.join(' · ') || '연결 공급자 없음'}</ThemedText>
            <ThemedText type="small" style={styles.muted}>{profile.email ?? '이메일 미제공'}</ThemedText>
          </View>
          <View style={[styles.region, compact && styles.regionCompact]}>
            <ThemedText type="small">{CITIES.find((city) => city.id === profile.city_id)?.name ?? profile.city_id ?? '지역 없음'}</ThemedText>
            <ThemedText type="small" style={styles.muted}>{ACCOUNT_TYPES[profile.account_type]}</ThemedText>
          </View>
        </View>
        <ThemedText accessibilityElementsHidden style={styles.chevron}>›</ThemedText>
      </Pressable>)}</View>
      {result.total === 0 && <ThemedText style={styles.empty}>일치하는 회원이 없습니다.</ThemedText>}
      {result.rows.length < result.total && <Pressable disabled={busy} onPress={() => void more()} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.button, busy && styles.disabled, pressed && styles.pressed]}><ThemedText>{busy ? '불러오는 중' : '회원 더 보기'}</ThemedText></Pressable>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three }, muted: { color: Colors.light.textSecondary }, error: { color: Colors.light.accent },
  heading: { gap: Spacing.two }, title: { fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  viewer: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, backgroundColor: Colors.light.backgroundElement, borderRadius: 8 },
  searchRow: { flexDirection: 'row', gap: Spacing.two },
  input: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, color: Colors.light.text, backgroundColor: Colors.light.card },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  searchButton: { backgroundColor: Colors.light.accent, borderColor: Colors.light.accent }, searchText: { color: Colors.light.accentInk },
  rows: { borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.light.card },
  tableHeading: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, backgroundColor: Colors.light.backgroundElement },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.light.line, minHeight: 80 },
  lastRow: { borderBottomWidth: 0 }, rowContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowContentCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  identity: { flex: 1, minWidth: 0, gap: Spacing.one }, login: { flex: 1, minWidth: 0, gap: Spacing.one },
  region: { width: 128, gap: Spacing.one }, regionCompact: { width: '100%', flexDirection: 'row', gap: Spacing.two },
  id: { color: Colors.light.textSecondary, fontFamily: 'monospace', fontSize: 11 },
  chevron: { width: 12, color: Colors.light.textSecondary, fontSize: 22 }, chevronSpace: { width: 12 },
  rowPressed: { backgroundColor: Colors.light.backgroundElement }, pressed: { opacity: 0.65 }, disabled: { opacity: 0.55 },
  empty: { textAlign: 'center', padding: Spacing.five, color: Colors.light.textSecondary },
});

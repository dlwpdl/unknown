import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AdminAnalyticsView } from '@/components/admin/admin-analytics';
import { AdminTicketmasterView } from '@/components/admin/admin-ticketmaster';
import { AdminMerchantsView } from '@/components/admin/admin-merchants';
import { AdminCommandPalette } from '@/components/admin/admin-command-palette';
import { AdminSectionView } from '@/components/admin/admin-section';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminSignupAlerts } from '@/components/admin/admin-signup-alerts';
import { AdminUserDetail } from '@/components/admin/admin-user-detail';
import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { initialAdminSection, type AdminSection } from '@/lib/admin';
import {
  ADMIN_PAGE_SIZE,
  getLocalAdminDashboard,
  loadAdminDashboard,
  loadMoreAdminData,
  moderateAdminReport,
  setAdminAccountStatus,
  setAdminVerificationLevel,
  type AdminDashboardData,
  type AdminModerationAction,
} from '@/lib/admin-data';
import { resolveReportBatch } from '@/lib/admin-report-batch';
import { supabase } from '@/lib/supabase';

export function AdminScreen() {
  const { safety, alert, section: requestedSection } = useLocalSearchParams<{ safety?: string; alert?: string; section?: string }>();
  const { isAuthed, isAdmin, isAuthLoading, authError, signInAdmin, signInGoogle, signOut, me } = useAuth();
  const [section, setSection] = useState<AdminSection>(initialAdminSection(requestedSection, alert, safety));
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [moderationResult, setModerationResult] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState<Set<AdminSection>>(new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const localPreview = false;
  const hasAdminAccess = isAdmin || localPreview;
  const needsOperations = section !== 'analytics' && section !== 'ticketmaster' && section !== 'merchants';

  const refresh = useCallback(async () => {
    if (!hasAdminAccess) return;
    if (!needsOperations) { setAnalyticsRefresh((value) => value + 1); return; }
    setLoading(true);
    setError(null);
    try {
      setData(localPreview ? getLocalAdminDashboard() : await loadAdminDashboard(supabase));
      setExhausted(new Set());
      setLastLoadedAt(new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
    } catch {
      setError('관리자 데이터를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  }, [hasAdminAccess, localPreview, needsOperations]);

  useEffect(() => {
    let active = true;
    if (!hasAdminAccess || !needsOperations) return;
    const request = localPreview ? Promise.resolve(getLocalAdminDashboard()) : loadAdminDashboard(supabase);
    void request
      .then((next) => {
        if (!active) return;
        setData(next);
        setLastLoadedAt(new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('관리자 데이터를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [hasAdminAccess, localPreview, needsOperations]);

  const profiles = useMemo(
    () => new Map(data?.profiles.map((profile) => [profile.id, profile]) ?? []),
    [data?.profiles],
  );

  const confirmResolve = async (reportId: string | string[], action: AdminModerationAction['action'], note: string): Promise<string[]> => {
    if (localPreview || resolvingRef.current) return [];
    const ids = [...new Set(Array.isArray(reportId) ? reportId : [reportId])];
    if (!ids.length) return [];
    const labels = { dismissed: '기각', warned: '경고', blocked: '계정 정지', hidden: '콘텐츠 전체 숨김' };
    const message = action === 'hidden' ? '콘텐츠의 일반 사용자 노출을 중단합니다. 원본과 운영 기록은 보존합니다.' : action === 'blocked' ? '즉시 새 활동이 제한되고 신고별로 사용자에게 알림이 전송됩니다.' : action === 'warned' ? '신고별로 대상 계정에 경고 알림이 전송됩니다.' : '처리 결과는 운영 기록에 남습니다.';
    resolvingRef.current = true;
    setResolving(true);
    try {
      const description = `${ids.length}건을 ${labels[action]} 처리할까요?\n${message}\n공통 메모: ${note.trim() || '(없음)'}`;
      const confirmed = Platform.OS === 'web' ? window.confirm(description) : await new Promise<boolean>((resolve) => {
        Alert.alert('신고 처리 확인', description, [
          { text: '취소', style: 'cancel', onPress: () => resolve(false) },
          { text: '확인', style: action === 'blocked' ? 'destructive' : 'default', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) });
      });
      if (!confirmed) return [];
      setError(null);
      setModerationResult('처리 중…');
      const result = await resolveReportBatch(ids, (id) => moderateAdminReport(supabase, id, action, note));
      // Keep acknowledged successes closed even if reloading the dashboard fails.
      setData((current) => current && ({ ...current, reports: current.reports.map((report) => result.succeeded.includes(report.id)
        ? { ...report, status: action === 'dismissed' ? 'dismissed' : 'actioned' } : report) }));
      await refresh();
      setModerationResult(`${labels[action]}: 성공 ${result.succeeded.length}건 · 실패 ${result.failed.length}건${result.failed.length ? ` (신고 ID: ${result.failed.join(', ')}) — 실패한 항목의 현재 상태를 확인해주세요.` : ''}`);
      return result.succeeded;
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  };

  const loadMore = async () => {
    if (localPreview) {
      setExhausted((current) => new Set(current).add(section));
      return;
    }
    // 뜨는 글 알림 패널은 자체 RPC로 불러오므로 더 보기 대상이 아니다.
    if (!data || section === 'overview' || section === 'analytics' || section === 'ticketmaster' || section === 'merchants' || section === 'trending' || section === 'errors' || exhausted.has(section)) return;
    const offset = section === 'reports'
      ? data.reports.length
      : section === 'safety'
        ? data.safetyReviews.length
      : section === 'alerts'
        ? data.safetyAlerts.length
      : section === 'users'
        ? data.profiles.length
        : section === 'posts'
          ? data.posts.length
          : data.messages.length;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await loadMoreAdminData(supabase, section, offset);
      setData((current) => {
        if (!current) return current;
        const known = new Set(current.profiles.map((profile) => profile.id));
        const profiles = [...current.profiles, ...(page.profiles ?? []).filter((profile) => !known.has(profile.id))];
        if (page.section === 'safety') return { ...current, profiles, safetyReviews: [...current.safetyReviews, ...page.rows] };
        if (page.section === 'alerts') return { ...current, profiles, safetyAlerts: [...current.safetyAlerts, ...page.rows] };
        if (page.section === 'reports') return { ...current, profiles, reports: [...current.reports, ...page.rows] };
        if (page.section === 'users') return { ...current, profiles: [...profiles, ...page.rows.filter((profile) => !known.has(profile.id))] };
        if (page.section === 'posts') return { ...current, profiles, posts: [...current.posts, ...page.rows] };
        return { ...current, profiles, messages: [...current.messages, ...page.rows] };
      });
      if (page.rows.length < ADMIN_PAGE_SIZE) setExhausted((current) => new Set(current).add(section));
    } catch {
      setError('이전 기록을 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  // ⌘K / Ctrl+K: 화면 이동과 회원 찾기를 한 번에. 데스크톱 단축키, 폰은 섹션 선택기의 검색 버튼.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !hasAdminAccess) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((value) => !value); }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasAdminAccess]);

  if (isAuthLoading && isAuthed) return <CenteredState title="관리자 세션을 확인하는 중입니다." />;
  if (!isAuthed && !localPreview) {
    return <LoginPanel reason="관리자 계정으로 로그인해주세요." onGoogle={signInGoogle} onAdminLogin={signInAdmin} loading={isAuthLoading} error={authError} />;
  }
  if (!isAdmin && !localPreview) {
    return <CenteredState title="관리자 권한이 없습니다." body="현재 계정에는 admin 역할이 지정되지 않았습니다." action="다른 계정으로 로그인" onAction={() => void signOut()} />;
  }
  if (!data && needsOperations) {
    return <CenteredState title={loading ? '운영 데이터를 불러오는 중입니다.' : '운영 데이터를 열 수 없습니다.'} body={error ?? undefined} action={loading ? undefined : '다시 시도'} onAction={loading ? undefined : () => void refresh()} />;
  }

  return (
    <AdminShell activeSection={section} counts={data?.counts ?? { alertsOpen: 0, reports: 0, openReports: 0, profiles: 0, posts: 0, messages: 0, safetyPending: 0, safetyHigh: 0 }} busy={needsOperations && loading} lastUpdated={needsOperations ? lastLoadedAt : null} onSearch={() => setPaletteOpen(true)} onSection={(next) => { if (!needsOperations && next !== 'analytics') { setLoading(true); setError(null); } setSection(next); }} onRefresh={() => void refresh()} onSignOut={() => void signOut()}>
      {isAdmin && <AdminSignupAlerts key={me.id} userId={me.id} onUser={setSelectedUserId} />}
      {localPreview && <View accessibilityRole="alert" style={styles.preview}><ThemedText type="smallBold">로컬 미리보기 · 실제 운영 데이터와 권한은 변경되지 않습니다.</ThemedText></View>}
      {!!moderationResult && needsOperations && <View accessibilityLiveRegion="polite" style={styles.preview}><ThemedText>{moderationResult}</ThemedText></View>}
      {!!error && needsOperations && <View accessibilityRole="alert" style={styles.error}><ThemedText style={styles.errorText}>{error}</ThemedText></View>}
      {section === 'analytics' ? <AdminAnalyticsView localPreview={localPreview} onUser={setSelectedUserId} refreshSignal={analyticsRefresh} /> : section === 'ticketmaster' ? <AdminTicketmasterView localPreview={localPreview} refreshSignal={analyticsRefresh} /> : section === 'merchants' ? <AdminMerchantsView refreshSignal={analyticsRefresh} onUser={setSelectedUserId} localPreview={localPreview} /> : data && <AdminSectionView
        key={section}
        section={section}
        data={data}
        localPreview={localPreview}
        resolving={resolving}
        loadingMore={loadingMore}
        noMore={exhausted.has(section)}
        onUser={setSelectedUserId}
        onResolve={confirmResolve}
        onLoadMore={() => void loadMore()}
      />}
      <AdminUserDetail
        userId={selectedUserId}
        profiles={profiles}
        localData={localPreview ? data ?? undefined : undefined}
        onStatusChange={localPreview ? undefined : async (userId, status) => {
          await setAdminAccountStatus(supabase, userId, status);
          await refresh();
        }}
        onTrustLevelChange={localPreview ? undefined : async (userId, level) => {
          await setAdminVerificationLevel(supabase, userId, level);
          await refresh();
        }}
        onClose={() => setSelectedUserId(null)}
      />
      {paletteOpen && <AdminCommandPalette
        visible={paletteOpen}
        localPreview={localPreview}
        onClose={() => setPaletteOpen(false)}
        onSection={(next) => { if (!needsOperations && next !== 'analytics') { setLoading(true); setError(null); } setSection(next); }}
        onUser={(userId) => setSelectedUserId(userId)}
      />}
    </AdminShell>
  );
}

function CenteredState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  const { play } = useInteractionFeedback();
  return (
    <ThemeOverrideProvider scheme="admin"><View style={styles.center}>
      <View style={styles.stateCard}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {!!body && <ThemedText style={styles.muted}>{body}</ThemedText>}
        {!!action && !!onAction && <Pressable onPress={() => { play('selection'); onAction(); }} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={styles.buttonText}>{action}</ThemedText></Pressable>}
      </View>
    </View></ThemeOverrideProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, backgroundColor: Colors.admin.background },
  stateCard: { width: 440, maxWidth: '100%', padding: Spacing.five, alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  muted: { textAlign: 'center', color: Colors.admin.textSecondary },
  button: { minHeight: 44, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: Colors.admin.accent },
  buttonText: { color: Colors.admin.accentInk },
  error: { marginBottom: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: '#EED3D9', borderRadius: 8, backgroundColor: Colors.admin.dangerBackground },
  errorText: { color: Colors.admin.danger },
  preview: { marginBottom: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.backgroundElement },
});

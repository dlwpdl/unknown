import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AdminSectionView } from '@/components/admin/admin-section';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminUserDetail } from '@/components/admin/admin-user-detail';
import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { canUseLocalAdminPreview, type AdminSection } from '@/lib/admin';
import {
  ADMIN_PAGE_SIZE,
  getLocalAdminDashboard,
  loadAdminDashboard,
  loadMoreAdminData,
  moderateAdminReport,
  setAdminAccountStatus,
  type AdminDashboardData,
} from '@/lib/admin-data';
import { supabase } from '@/lib/supabase';

export function AdminScreen() {
  const { safety } = useLocalSearchParams<{ safety?: string }>();
  const { isAuthed, isAdmin, isAuthLoading, authError, signInKakao, signInDev, signOut } = useAuth();
  const [section, setSection] = useState<AdminSection>(safety ? 'safety' : 'overview');
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState<Set<AdminSection>>(new Set());
  const [localPreview, setLocalPreview] = useState(false);
  const localPreviewAllowed = canUseLocalAdminPreview(
    __DEV__,
    typeof location === 'undefined' ? '' : location.hostname,
  );
  const hasAdminAccess = isAdmin || localPreview;

  const refresh = useCallback(async () => {
    if (!hasAdminAccess) return;
    setLoading(true);
    setError(null);
    try {
      setData(localPreview ? getLocalAdminDashboard() : await loadAdminDashboard(supabase));
      setExhausted(new Set());
    } catch {
      setError('관리자 데이터를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  }, [hasAdminAccess, localPreview]);

  useEffect(() => {
    let active = true;
    if (!hasAdminAccess) return;
    const request = localPreview ? Promise.resolve(getLocalAdminDashboard()) : loadAdminDashboard(supabase);
    void request
      .then((next) => {
        if (!active) return;
        setData(next);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('관리자 데이터를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [hasAdminAccess, localPreview]);

  const profiles = useMemo(
    () => new Map(data?.profiles.map((profile) => [profile.id, profile]) ?? []),
    [data?.profiles],
  );

  const resolveReport = async (reportId: string, action: 'dismissed' | 'warned' | 'blocked', note: string) => {
    if (localPreview) return;
    setResolving(true);
    setError(null);
    try {
      await moderateAdminReport(supabase, reportId, action, note);
      await refresh();
    } catch {
      setError('신고를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setResolving(false);
    }
  };

  const confirmResolve = (reportId: string, action: 'dismissed' | 'warned' | 'blocked', note: string) => {
    const labels = { dismissed: '신고를 기각할까요?', warned: '대상 계정에 경고를 보낼까요?', blocked: '대상 계정을 차단할까요?' };
    Alert.alert(labels[action], action === 'blocked' ? '확인하면 즉시 새 활동이 제한되고 사용자에게 알림이 전송됩니다.' : '처리 결과는 운영 기록에 남습니다.', [
      { text: '취소', style: 'cancel' },
      { text: '확인', style: action === 'blocked' ? 'destructive' : 'default', onPress: () => void resolveReport(reportId, action, note) },
    ]);
  };

  const loadMore = async () => {
    if (localPreview) {
      setExhausted((current) => new Set(current).add(section));
      return;
    }
    if (!data || section === 'overview' || exhausted.has(section)) return;
    const offset = section === 'reports'
      ? data.reports.length
      : section === 'safety'
        ? data.safetyReviews.length
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
        if (page.section === 'safety') return { ...current, safetyReviews: [...current.safetyReviews, ...page.rows] };
        if (page.section === 'reports') return { ...current, reports: [...current.reports, ...page.rows] };
        if (page.section === 'users') return { ...current, profiles: [...current.profiles, ...page.rows] };
        if (page.section === 'posts') return { ...current, posts: [...current.posts, ...page.rows] };
        return { ...current, messages: [...current.messages, ...page.rows] };
      });
      if (page.rows.length < ADMIN_PAGE_SIZE) setExhausted((current) => new Set(current).add(section));
    } catch {
      setError('이전 기록을 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (isAuthLoading) return <CenteredState title="관리자 세션을 확인하는 중입니다." />;
  if (!isAuthed && !localPreview) {
    return <LoginPanel reason={localPreviewAllowed ? '로컬 관리자 미리보기입니다. 버튼을 누르면 바로 열립니다.' : '관리자용 카카오 계정으로 로그인해주세요.'} onKakao={localPreviewAllowed ? () => setLocalPreview(true) : () => void signInKakao()} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;
  }
  if (!isAdmin && !localPreview) {
    return <CenteredState title="관리자 권한이 없습니다." body="현재 카카오 계정에는 admin 역할이 지정되지 않았습니다." action="다른 계정으로 로그인" onAction={() => void signOut()} />;
  }
  if (!data) {
    return <CenteredState title={loading ? '운영 데이터를 불러오는 중입니다.' : '운영 데이터를 열 수 없습니다.'} body={error ?? undefined} action={loading ? undefined : '다시 시도'} onAction={loading ? undefined : () => void refresh()} />;
  }

  return (
    <AdminShell activeSection={section} counts={data.counts} busy={loading} onSection={setSection} onRefresh={() => void refresh()} onSignOut={localPreview ? () => { setLocalPreview(false); setData(null); } : () => void signOut()}>
      {localPreview && <View accessibilityRole="alert" style={styles.preview}><ThemedText type="smallBold">로컬 미리보기 · 실제 운영 데이터와 권한은 변경되지 않습니다.</ThemedText></View>}
      {!!error && <View accessibilityRole="alert" style={styles.error}><ThemedText style={styles.errorText}>{error}</ThemedText></View>}
      <AdminSectionView
        section={section}
        data={data}
        resolving={resolving}
        loadingMore={loadingMore}
        noMore={exhausted.has(section)}
        onUser={setSelectedUserId}
        onResolve={confirmResolve}
        onLoadMore={() => void loadMore()}
      />
      <AdminUserDetail
        userId={selectedUserId}
        profiles={profiles}
        localData={localPreview ? data : undefined}
        onStatusChange={localPreview ? undefined : async (userId, status) => {
          await setAdminAccountStatus(supabase, userId, status);
          await refresh();
        }}
        onClose={() => setSelectedUserId(null)}
      />
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
  return (
    <View style={styles.center}>
      <View style={styles.stateCard}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {!!body && <ThemedText style={styles.muted}>{body}</ThemedText>}
        {!!action && !!onAction && <Pressable onPress={onAction} accessibilityRole="button" style={styles.button}><ThemedText type="smallBold" style={styles.buttonText}>{action}</ThemedText></Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, backgroundColor: Colors.light.background },
  stateCard: { width: 440, maxWidth: '100%', padding: Spacing.five, alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  muted: { textAlign: 'center', color: Colors.light.textSecondary },
  button: { minHeight: 44, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: Colors.light.accent },
  buttonText: { color: Colors.light.accentInk },
  error: { marginBottom: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: '#E8B8AE', borderRadius: 8, backgroundColor: '#F9ECE9' },
  errorText: { color: Colors.light.accent },
  preview: { marginBottom: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.backgroundElement },
});

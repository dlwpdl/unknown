import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { reportReasonLabel, reportStatusLabel, reportTargetLabel } from '@/lib/admin';
import {
  getLocalAdminUserActivity,
  loadAdminUserActivity,
  type AdminDashboardData,
  type AdminProfile,
  type AdminUserActivity,
} from '@/lib/admin-data';
import { supabase } from '@/lib/supabase';

export function AdminUserDetail({
  userId,
  profiles,
  localData,
  onStatusChange,
  onClose,
}: {
  userId: string | null;
  profiles: Map<string, AdminProfile>;
  localData?: AdminDashboardData;
  onStatusChange?: (userId: string, status: 'active' | 'reactivation_pending') => Promise<void>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    userId: string;
    activity: AdminUserActivity | null;
    error: string | null;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!userId || localData) return;
    void loadAdminUserActivity(supabase, userId)
      .then((activity) => active && setResult({ userId, activity, error: null }))
      .catch(() => active && setResult({ userId, activity: null, error: '사용자 활동을 불러오지 못했습니다.' }));
    return () => { active = false; };
  }, [localData, userId]);

  const activity = userId && localData
    ? getLocalAdminUserActivity(localData, userId)
    : result?.userId === userId ? result.activity : null;
  const error = localData ? null : result?.userId === userId ? result.error : null;

  const changeStatus = async (status: 'active' | 'reactivation_pending') => {
    if (!userId || !onStatusChange || statusBusy) return;
    setStatusBusy(true);
    try {
      await onStatusChange(userId, status);
      setResult((current) => current?.activity ? {
        ...current,
        activity: { ...current.activity, profile: { ...current.activity.profile, account_status: status } },
      } : current);
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <Modal visible={userId != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="사용자 전체 활동">
          <View style={styles.header}>
            <View>
              <ThemedText type="subtitle" accessibilityRole="header">사용자 전체 활동</ThemedText>
              <ThemedText type="small" style={styles.muted}>{userId}</ThemedText>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="사용자 상세 닫기" style={styles.close}>
              <ThemedText type="smallBold">닫기</ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {error && <View accessibilityRole="alert" style={styles.notice}><ThemedText style={styles.danger}>{error}</ThemedText></View>}
            {!error && !activity && <View accessibilityRole="progressbar" style={styles.notice}><ThemedText style={styles.muted}>활동 기록을 불러오는 중입니다.</ThemedText></View>}
            {activity && <ActivityContent activity={activity} profiles={profiles} statusBusy={statusBusy} onStatusChange={onStatusChange ? changeStatus : undefined} />}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ActivityContent({
  activity,
  profiles,
  statusBusy,
  onStatusChange,
}: {
  activity: AdminUserActivity;
  profiles: Map<string, AdminProfile>;
  statusBusy: boolean;
  onStatusChange?: (status: 'active' | 'reactivation_pending') => Promise<void>;
}) {
  const status = activity.profile.account_status;
  return (
    <>
      <View style={styles.profileRow}>
        <View style={styles.avatar} accessibilityElementsHidden>
          <ThemedText type="subtitle" style={styles.avatarText}>{activity.profile.nickname.trim().slice(0, 1)}</ThemedText>
        </View>
        <View style={styles.profile}>
          <ThemedText type="title" accessibilityRole="header" style={styles.name}>{activity.profile.nickname}</ThemedText>
          <ThemedText style={styles.muted}>{activity.profile.city_id ?? '지역 삭제됨'}{activity.profile.neighborhood ? ` · ${activity.profile.neighborhood}` : ''} · 신뢰 레벨 {activity.profile.verification_level}</ThemedText>
          <ThemedText type="smallBold" style={status === 'active' ? styles.muted : styles.danger}>계정 상태 · {accountStatusLabel(status)}</ThemedText>
          {!!activity.profile.bio && <ThemedText>{activity.profile.bio}</ThemedText>}
          {!!activity.profile.account_status_note && <ThemedText type="small" style={styles.muted}>{activity.profile.account_status_note}</ThemedText>}
          {onStatusChange && status === 'deleted' && (
            <Pressable onPress={() => void onStatusChange('reactivation_pending')} disabled={statusBusy} accessibilityRole="button" style={styles.statusButton}>
              <ThemedText type="smallBold">{statusBusy ? '처리 중' : '재가입 허용'}</ThemedText>
            </Pressable>
          )}
          {onStatusChange && status === 'suspended' && (
            <Pressable onPress={() => void onStatusChange('active')} disabled={statusBusy} accessibilityRole="button" style={styles.statusButton}>
              <ThemedText type="smallBold">{statusBusy ? '처리 중' : '이용 제한 해제'}</ThemedText>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.metrics}>
        {[['글', activity.posts.length], ['댓글', activity.comments.length], ['대화', activity.conversations.length], ['메시지', activity.messages.length], ['신고', activity.reports.length]].map(([label, value]) => (
          <View key={label} style={styles.metric}><ThemedText type="small" style={styles.muted}>{label}</ThemedText><ThemedText type="subtitle">{value}</ThemedText></View>
        ))}
      </View>

      <ActivityGroup title="게시글" empty={activity.posts.length === 0}>
        {activity.posts.map((post) => <ActivityRow key={post.id} title={post.title} body={post.body} meta={`${post.status === 'removed' ? '삭제됨' : '게시중'} · ${formatDate(post.created_at)}`} />)}
      </ActivityGroup>
      <ActivityGroup title="댓글" empty={activity.comments.length === 0}>
        {activity.comments.map((comment) => <ActivityRow key={comment.id} title={`게시글 ${shortId(comment.post_id)}`} body={comment.body} meta={`${comment.deleted_at ? '삭제됨' : '게시중'} · ${formatDate(comment.created_at)}`} />)}
      </ActivityGroup>
      <ActivityGroup title="대화 내용" empty={activity.messages.length === 0}>
        {activity.messages.map((message) => <ActivityRow key={message.id} title={profiles.get(message.sender_id)?.nickname ?? shortId(message.sender_id)} body={message.body} meta={`대화 ${shortId(message.conversation_id)} · ${formatDate(message.created_at)}`} />)}
      </ActivityGroup>
      <ActivityGroup title="신고 이력" empty={activity.reports.length === 0}>
        {activity.reports.map((report) => <ActivityRow key={report.id} title={`${reportReasonLabel(report.reason_code)} · ${reportStatusLabel(report.status)}`} body={report.details || '상세 설명 없음'} meta={`${reportTargetLabel(report.target_type)} · ${formatDate(report.created_at)}`} />)}
      </ActivityGroup>
    </>
  );
}

function ActivityGroup({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return <View style={styles.group}><ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>{empty ? <ThemedText style={styles.muted}>기록 없음</ThemedText> : children}</View>;
}

function ActivityRow({ title, body, meta }: { title: string; body: string; meta: string }) {
  return <View style={styles.row}><ThemedText type="smallBold">{title}</ThemedText><ThemedText>{body}</ThemedText><ThemedText type="small" style={styles.muted}>{meta}</ThemedText></View>;
}

function shortId(value: string) { return value.slice(0, 8); }
function accountStatusLabel(value: AdminProfile['account_status']) {
  return { active: '정상', suspended: '이용 제한', deleted: '탈퇴·재가입 잠금', reactivation_pending: '재가입 허용됨' }[value];
}
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(24, 26, 29, 0.35)' },
  sheet: { width: 680, maxWidth: '100%', height: '100%', backgroundColor: Colors.light.background, borderLeftWidth: 1, borderLeftColor: Colors.light.line },
  header: { minHeight: 76, paddingHorizontal: Spacing.four, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.light.line, backgroundColor: Colors.light.card },
  close: { minHeight: 40, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8 },
  body: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  muted: { color: Colors.light.textSecondary },
  danger: { color: Colors.light.accent },
  notice: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  profileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  avatar: { width: 48, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: Colors.light.backgroundSelected },
  avatarText: { color: Colors.light.accent },
  profile: { flex: 1, gap: Spacing.one },
  statusButton: { alignSelf: 'flex-start', minHeight: 38, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  name: { fontSize: 28, lineHeight: 34 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { minWidth: 90, flexGrow: 1, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  group: { gap: Spacing.two },
  row: { padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
});

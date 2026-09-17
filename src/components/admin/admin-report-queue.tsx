import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import {
  canResolveReport,
  filterAdminReports,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  type ReportFilter,
} from '@/lib/admin';
import type { AdminModerationAction, AdminProfile, AdminReport } from '@/lib/admin-data';

const REPORT_FILTERS: { id: ReportFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'open', label: '미처리' },
  { id: 'actioned', label: '조치함' },
  { id: 'dismissed', label: '기각' },
];

export function AdminReportQueue({
  reports,
  profiles,
  actions,
  resolving,
  onUser,
  onResolve,
}: {
  reports: AdminReport[];
  profiles: Map<string, AdminProfile>;
  actions: AdminModerationAction[];
  resolving: boolean;
  onUser: (userId: string) => void;
  onResolve: (reportId: string, action: AdminModerationAction['action'], note: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [note, setNote] = useState('');
  const visibleReports = filterAdminReports(reports, filter);
  const selected = visibleReports.find((report) => report.id === selectedId) ?? visibleReports[0] ?? null;
  const action = selected ? actions.find((item) => item.report_id === selected.id) : null;

  if (reports.length === 0) return <EmptyState text="접수된 신고가 없습니다." />;

  return (
    <View style={styles.queue}>
      <View accessibilityRole="tablist" accessibilityLabel="신고 상태 필터" style={styles.filters}>
        {REPORT_FILTERS.map((item) => {
          const active = item.id === filter;
          const count = item.id === 'all' ? reports.length : reports.filter((report) => report.status === item.id).length;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                setFilter(item.id);
                setNote('');
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.filter, active && styles.filterActive]}>
              <ThemedText type="smallBold" style={active ? styles.filterTextActive : styles.muted}>{item.label}</ThemedText>
              <ThemedText type="small" style={[styles.filterCount, active && styles.filterTextActive]}>{count}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {visibleReports.length === 0 ? <EmptyState text="이 상태의 신고가 없습니다." /> : (
        <View style={styles.split}>
          <View style={styles.list} accessibilityRole="list">
            {visibleReports.map((report) => {
              const active = report.id === selected?.id;
              return (
                <Pressable
                  key={report.id}
                  onPress={() => {
                    setSelectedId(report.id);
                    setNote('');
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.row, active && styles.rowActive]}>
                  <View style={styles.rowTop}>
                    <ThemedText type="smallBold">{profiles.get(report.reported_user_id)?.nickname ?? '알 수 없는 사용자'}</ThemedText>
                    <StatusPill status={report.status} />
                  </View>
                  <ThemedText type="small" style={styles.muted}>{report.source === 'block' ? '직접 차단' : reportReasonLabel(report.reason_code)} · {report.blocked_at ? '차단 동반 · ' : ''}{reportTargetLabel(report.target_type)} · {formatDate(report.created_at)}</ThemedText>
                  <ThemedText type="small" numberOfLines={2}>{report.details || '상세 설명 없음'}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          {selected && (
            <View style={styles.detail}>
              <View style={styles.rowTop}>
                <ThemedText type="subtitle" accessibilityRole="header">신고 상세</ThemedText>
                <StatusPill status={selected.status} />
              </View>
              <LabelValue label="신고 대상" value={profiles.get(selected.reported_user_id)?.nickname ?? selected.reported_user_id} />
              <LabelValue label="유형" value={`${reportTargetLabel(selected.target_type)} · ${reportReasonLabel(selected.reason_code)}`} />
              <LabelValue label="내용" value={selected.details || '상세 설명 없음'} />
              <LabelValue label="신고자" value={profiles.get(selected.reporter_id)?.nickname ?? selected.reporter_id} />
              <LabelValue label="노출 범위" value={selected.blocked_at
                ? '신고자에게 작성자의 콘텐츠 숨김 · 다른 회원의 노출은 별도 운영 조치'
                : selected.target_type === 'user' ? '사용자 검토 요청 · 자동 전체 숨김 없음'
                : '신고자에게 해당 콘텐츠 숨김 · 다른 회원의 노출은 별도 운영 조치'} />
              <LabelValue label="접수 당시 원본" value={selected.evidence
                ? [selected.evidence.title, selected.evidence.body, selected.evidence.nickname].filter(Boolean).join('\n') || '텍스트 없음'
                : '이전 신고에는 원본 스냅샷이 없습니다. 사용자 전체 활동에서 확인하세요.'} />
              <LabelValue label="대상 ID" value={selected.target_id} />
              {!!selected.evidence?.image_paths?.length && <LabelValue label="첨부 원본 경로" value={selected.evidence.image_paths.join('\n')} />}
              <ThemedText type="small" style={styles.muted}>신고·차단은 위반 확정이 아닙니다. 전체 숨김은 공개만 중단하며 원본과 처리 기록은 보존 정책에 따라 보관합니다.</ThemedText>
              <Pressable onPress={() => onUser(selected.reported_user_id)} accessibilityRole="button" style={styles.outlineButton}>
                <ThemedText type="smallBold">사용자 전체 활동 보기</ThemedText>
              </Pressable>

              {canResolveReport(selected.status) ? (
                <View style={styles.resolveBox}>
                  <ThemedText type="smallBold">처리 메모</ThemedText>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="판단 근거와 후속 조치를 남겨주세요"
                    placeholderTextColor={Colors.light.textSecondary}
                    multiline
                    accessibilityLabel="신고 처리 메모"
                    style={styles.noteInput}
                  />
                  <View style={styles.actions}>
                    {selected.target_type !== 'user' && <Pressable
                      onPress={() => onResolve(selected.id, 'hidden', note)}
                      disabled={resolving} accessibilityRole="button" accessibilityState={{ disabled: resolving, busy: resolving }}
                      style={[styles.dangerButton, resolving && styles.disabled]}>
                      <ThemedText type="smallBold" style={styles.primaryText}>콘텐츠 전체 숨김</ThemedText>
                    </Pressable>}
                    <Pressable
                      onPress={() => onResolve(selected.id, 'dismissed', note)}
                      disabled={resolving}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: resolving, busy: resolving }}
                      style={[styles.outlineButton, resolving && styles.disabled]}>
                      <ThemedText type="smallBold">기각</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => onResolve(selected.id, 'warned', note)}
                      disabled={resolving}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: resolving, busy: resolving }}
                      style={[styles.primaryButton, resolving && styles.disabled]}>
                      <ThemedText type="smallBold" style={styles.primaryText}>{resolving ? '처리 중' : '경고'}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => onResolve(selected.id, 'blocked', note)}
                      disabled={resolving}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: resolving, busy: resolving }}
                      style={[styles.dangerButton, resolving && styles.disabled]}>
                      <ThemedText type="smallBold" style={styles.primaryText}>계정 정지</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <LabelValue label="처리 기록" value={`${action ? ({ hidden: '콘텐츠 전체 숨김', blocked: '계정 정지', warned: '경고', dismissed: '기각' }[action.action]) : reportStatusLabel(selected.status)}${action?.note ? ` · ${action.note}` : ''}`} />
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StatusPill({ status }: { status: AdminReport['status'] }) {
  return (
    <View style={[styles.status, status === 'open' && styles.statusOpen]}>
      <ThemedText type="smallBold" style={[styles.statusText, status === 'open' && styles.statusTextOpen]}>
        {reportStatusLabel(status)}
      </ThemedText>
    </View>
  );
}

function LabelValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.labelValue}><ThemedText type="small" style={styles.label}>{label}</ThemedText><ThemedText>{value}</ThemedText></View>;
}

function EmptyState({ text }: { text: string }) {
  return <View accessibilityRole="text" style={styles.empty}><ThemedText style={styles.muted}>{text}</ThemedText></View>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  queue: { gap: Spacing.three },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  filter: { minHeight: 40, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterActive: { borderBottomColor: Colors.light.accent },
  filterCount: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, textAlign: 'center', borderRadius: 10, color: Colors.light.textSecondary, backgroundColor: Colors.light.backgroundElement },
  filterTextActive: { color: Colors.light.accent },
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  list: { flex: 1, minWidth: 300, gap: Spacing.two },
  row: { padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  rowActive: { borderColor: Colors.light.navy, backgroundColor: '#F4F7F9' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  detail: { width: 380, maxWidth: '100%', padding: Spacing.four, gap: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  muted: { color: Colors.light.textSecondary },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: Colors.light.backgroundElement },
  statusOpen: { backgroundColor: '#F5E4E0' },
  statusText: { fontSize: 11, color: Colors.light.textSecondary },
  statusTextOpen: { color: Colors.light.accent },
  labelValue: { gap: Spacing.one },
  label: { color: Colors.light.textSecondary },
  resolveBox: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, borderTopColor: Colors.light.line },
  noteInput: { minHeight: 92, padding: Spacing.three, textAlignVertical: 'top', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, color: Colors.light.text, backgroundColor: Colors.light.background },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  outlineButton: { minHeight: 40, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  primaryButton: { minHeight: 40, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: Colors.light.accent },
  dangerButton: { minHeight: 40, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#9D241A' },
  primaryText: { color: Colors.light.accentInk },
  disabled: { opacity: 0.55 },
  empty: { minHeight: 180, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
});

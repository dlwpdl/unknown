import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import {
  canResolveReport,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
} from '@/lib/admin';
import { displayName } from '@/lib/admin-labels';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import type { AdminModerationAction, AdminProfile, AdminReport } from '@/lib/admin-data';

import { AdminFilterBar, AdminFilterReset, AdminMultiFilter, AdminSearch, AdminTableSummary } from './admin-table-controls';
import { filterReportRows } from './admin-report-filter';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminMerchantReviewReplyContent } from '@/components/admin/admin-merchant-review-reply-content';

const REPORT_FILTERS = ['open', 'actioned', 'dismissed'].map((value) => ({ value, label: reportStatusLabel(value as AdminReport['status']) }));
const TARGET_FILTERS = ['user', 'post', 'comment', 'message', 'merchant_review', 'merchant_review_reply'].map((value) => ({ value, label: reportTargetLabel(value) }));

export function AdminReportQueue({
  reports,
  profiles,
  actions,
  resolving,
  onUser,
  onResolve,
  localPreview = false,
}: {
  reports: AdminReport[];
  profiles: Map<string, AdminProfile>;
  actions: AdminModerationAction[];
  resolving: boolean;
  onUser: (userId: string) => void;
  onResolve: (reportId: string | string[], action: AdminModerationAction['action'], note: string) => Promise<string[]>;
  localPreview?: boolean;
}) {
  const { play } = useInteractionFeedback();
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState({ reportId: '', text: '' });
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const visibleReports = filterReportRows(reports.map((report) => ({
    ...report,
    searchText: [report.id, report.target_id, report.reported_user_id, report.reporter_id,
      profiles.get(report.reported_user_id)?.nickname, profiles.get(report.reporter_id)?.nickname,
      report.details, reportReasonLabel(report.reason_code), reportTargetLabel(report.target_type),
      report.source === 'block' ? '직접 차단' : '', report.evidence?.title, report.evidence?.body, report.evidence?.merchant_name].filter(Boolean).join(' '),
  })), query, statuses, targets);
  const selectable = visibleReports.filter((report) => canResolveReport(report.status));
  const checked = selectable.filter((report) => checkedIds.includes(report.id));
  const allChecked = selectable.length > 0 && checked.length === selectable.length;
  const resolveChecked = async (action: AdminModerationAction['action']) => {
    const succeeded = await onResolve(checked.map((report) => report.id), action, bulkNote);
    setCheckedIds((ids) => ids.filter((id) => !succeeded.includes(id)));
  };
  const selected = visibleReports.find((report) => report.id === selectedId) ?? visibleReports[0] ?? null;
  const note = draft.reportId === selected?.id ? draft.text : '';
  const setNote = (text: string) => setDraft({ reportId: selected?.id ?? '', text });
  if (draft.reportId !== (selected?.id ?? '')) {
    setDraft({ reportId: selected?.id ?? '', text: '' });
  }
  const action = selected ? actions.find((item) => item.report_id === selected.id) : null;

  if (reports.length === 0) return <EmptyState text="접수된 신고가 없습니다." />;

  // 폰에서는 목록과 상세를 나란히 둘 수 없다. 같은 버튼 묶음을 데스크톱은 상세 안에,
  // 폰은 시트 하단 고정 바에 그대로 쓴다.
  // 좁은 화면의 하단 고정 바는 네 칸이라 라벨이 길면 두 줄로 접힌다. 그때만 짧은 라벨을 쓴다.
  const resolveButtons = (report: AdminReport, short = false) => (
    <>
      {report.target_type !== 'user' && <Pressable
        onPress={() => { play('selection'); return onResolve(report.id, 'hidden', note); }}
        disabled={resolving} accessibilityRole="button" accessibilityState={{ disabled: resolving, busy: resolving }}
        style={[styles.dangerButton, resolving && styles.disabled]}>
        <ThemedText type="smallBold" style={styles.dangerText}>{short ? '숨김' : '콘텐츠 전체 숨김'}</ThemedText>
      </Pressable>}
      <Pressable
        onPress={() => { play('selection'); return onResolve(report.id, 'dismissed', note); }}
        disabled={resolving} accessibilityRole="button" accessibilityState={{ disabled: resolving, busy: resolving }}
        style={[styles.outlineButton, resolving && styles.disabled]}>
        <ThemedText type="smallBold">기각</ThemedText>
      </Pressable>
      <Pressable
        onPress={() => { play('selection'); return onResolve(report.id, 'warned', note); }}
        disabled={resolving} accessibilityRole="button" accessibilityState={{ disabled: resolving, busy: resolving }}
        style={[styles.primaryButton, resolving && styles.disabled]}>
        <ThemedText type="smallBold" style={styles.primaryText}>{resolving ? '처리 중' : '경고'}</ThemedText>
      </Pressable>
      <Pressable
        onPress={() => { play('selection'); return onResolve(report.id, 'blocked', note); }}
        disabled={resolving} accessibilityRole="button" accessibilityState={{ disabled: resolving, busy: resolving }}
        style={[styles.dangerButton, resolving && styles.disabled]}>
        <ThemedText type="smallBold" style={styles.dangerText}>{short ? '정지' : '계정 정지'}</ThemedText>
      </Pressable>
    </>
  );

  const noteInput = (
    <TextInput
      value={note}
      onChangeText={setNote}
      placeholder="판단 근거와 후속 조치를 남겨주세요"
      placeholderTextColor={Colors.admin.textSecondary}
      multiline
      maxLength={1000}
      accessibilityLabel="신고 처리 메모"
      style={styles.noteInput}
    />
  );

  const detailFields = (report: AdminReport) => (
    <>
      <LabelValue label="접수 일시" value={formatDate(report.created_at)} />
      <LabelValue label="신고 대상" value={displayName(profiles.get(report.reported_user_id), report.reported_user_id)} />
      <LabelValue label="유형" value={`${reportTargetLabel(report.target_type)} · ${reportReasonLabel(report.reason_code)}`} />
      <LabelValue label="내용" value={report.details || '상세 설명 없음'} />
      <LabelValue label="신고자" value={displayName(profiles.get(report.reporter_id), report.reporter_id)} />
      <LabelValue label="노출 범위" value={report.blocked_at
        ? '신고자에게 작성자의 콘텐츠 숨김 · 다른 회원의 노출은 별도 운영 조치'
        : report.target_type === 'user' ? '사용자 검토 요청 · 자동 전체 숨김 없음'
        : '신고자에게 해당 콘텐츠 숨김 · 다른 회원의 노출은 별도 운영 조치'} />
      <LabelValue label="접수 당시 원본" value={report.evidence
        ? [report.evidence.title, report.evidence.body, report.evidence.nickname].filter(Boolean).join('\n') || '텍스트 없음'
        : '이전 신고에는 원본 스냅샷이 없습니다. 사용자 전체 활동에서 확인하세요.'} />
      {report.target_type === 'merchant_review' && <>
        <LabelValue label="접수 당시 업체 후기" value={`${report.evidence?.merchant_name ?? report.evidence?.merchant_id ?? '업체 정보 없음'}${report.evidence?.score == null ? '' : ` · ${report.evidence.score}/10`}${report.evidence?.status ? ` · ${report.evidence.status === 'removed' ? '숨김' : '게시 중'}` : ''}`} />
        <AdminMerchantReviewContent targetId={report.target_id} localPreview={localPreview} onUser={onUser} />
      </>}
      {report.target_type === 'merchant_review_reply' && <>
        <LabelValue label="접수 당시 업체" value={report.evidence?.merchant_name ?? report.evidence?.merchant_id ?? '업체 정보 없음'} />
        <AdminMerchantReviewReplyContent targetId={report.target_id} localPreview={localPreview} onUser={onUser} />
      </>}
      {!!report.evidence?.image_paths?.length && <LabelValue label="첨부 원본 경로" value={report.evidence.image_paths.join('\n')} />}
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: Colors.admin.textSecondary }}>원본 ID 보기</summary>
        <LabelValue label="대상 ID" value={report.target_id} />
        <LabelValue label="신고자 ID" value={report.reporter_id} />
        <LabelValue label="신고 ID" value={report.id} />
      </details>
      <ThemedText type="small" style={styles.muted}>신고·차단은 위반 확정이 아닙니다. 전체 숨김은 공개만 중단하며 원본과 처리 기록은 보존 정책에 따라 보관합니다.</ThemedText>
      <Pressable onPress={() => { play('selection'); return onUser(report.reported_user_id); }} accessibilityRole="button" style={styles.outlineButton}>
        <ThemedText type="smallBold">사용자 전체 활동 보기</ThemedText>
      </Pressable>
    </>
  );

  return (
    <View style={styles.queue}>
      <div className="admin-toolbar">
        <AdminSearch value={query} onChange={(value) => { setQuery(value); setCheckedIds([]); }} placeholder="사용자, 신고 내용, 사유, ID 검색" />
        {/* 미처리 건을 오갈 때 드롭다운을 두 번 조작하지 않도록 자주 쓰는 상태는 탭으로 둔다. */}
        <div className="admin-status-tabs" role="group" aria-label="신고 상태 빠른 필터">
          {[{ value: '', label: `전체 ${reports.length}` },
            ...REPORT_FILTERS.map((option) => ({ value: option.value, label: `${option.label} ${reports.filter((report) => report.status === option.value).length}` }))].map((option) => (
            <button key={option.value || 'all'} type="button"
              aria-pressed={option.value === '' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === option.value}
              onClick={() => { play('selection');  setStatuses(option.value ? [option.value] : []); setCheckedIds([]); }}>
              {option.label}
            </button>
          ))}
        </div>
        <AdminFilterBar applied={statuses.length + targets.length}>
          <div className="admin-filter-row">
            <AdminMultiFilter label="상태" options={REPORT_FILTERS} value={statuses} onChange={(value) => { setStatuses(value); setCheckedIds([]); }} />
            <AdminMultiFilter label="대상" options={TARGET_FILTERS} value={targets} onChange={(value) => { setTargets(value); setCheckedIds([]); }} />
            <AdminFilterReset disabled={!query && !statuses.length && !targets.length} onReset={() => { setQuery(''); setStatuses([]); setTargets([]); setCheckedIds([]); }} />
          </div>
        </AdminFilterBar>
        <AdminTableSummary shown={visibleReports.length} loaded={reports.length} />
      </div>

      <fieldset disabled={resolving} className="admin-bulk-reports">
        <div className="admin-filter-row">
          <label className="admin-report-check"><input type="checkbox" checked={allChecked}
            ref={(element) => { if (element) element.indeterminate = checked.length > 0 && !allChecked; }}
            disabled={!selectable.length || resolving}
            onChange={(event) => { play('selection'); setCheckedIds(event.target.checked ? selectable.map((report) => report.id) : []); }} />
            보이는 미처리 신고 전체 선택</label>
          <span aria-live="polite">{checked.length}건 선택</span>
          {checked.length > 0 && <button type="button" onClick={() => { play('selection'); return setCheckedIds([]); }}>선택 해제</button>}
        </div>
        {checked.length > 0 && <>
          <label>일괄 처리 메모
            <textarea aria-label="일괄 처리 메모" value={bulkNote} maxLength={1000} rows={2}
              onChange={(event) => setBulkNote(event.target.value)} placeholder="선택한 신고에 공통으로 남길 판단 근거" />
          </label>
          <div className="admin-filter-row">
            <button type="button" onClick={() => { play('selection'); return void resolveChecked('dismissed'); }}>선택 기각</button>
            <button type="button" onClick={() => { play('selection'); return void resolveChecked('warned'); }}>선택 경고</button>
            <button type="button" onClick={() => { play('selection'); return void resolveChecked('blocked'); }}>선택 계정 정지</button>
            <button type="button" disabled={checked.some((report) => report.target_type === 'user')}
              onClick={() => { play('selection'); return void resolveChecked('hidden'); }}>선택 콘텐츠 전체 숨김</button>
          </div>
          {checked.some((report) => report.target_type === 'user') && <small>콘텐츠 전체 숨김은 게시글·댓글·메시지·업체 후기 신고만 선택했을 때 사용할 수 있습니다.</small>}
          <small>선택한 신고 각각에 처리 기록과 메모가 남습니다. 같은 회원의 신고가 여러 건이면 경고·정지 알림도 신고별로 전송됩니다.</small>
        </>}
      </fieldset>

      {visibleReports.length === 0 ? <EmptyState text="검색 조건에 맞는 신고가 없습니다." /> : (
        <View style={styles.split}>
          <div style={{ flex: 1, minWidth: 280 }} aria-label="신고 목록">
            {visibleReports.map((report) => {
              const active = report.id === selected?.id;
              return (
                <div key={report.id} style={{ display: 'flex', alignItems: 'center' }}>
                <label className="admin-report-check" style={{ flexShrink: 0 }}>
                  <input type="checkbox" aria-label={`신고 ${report.id} 선택`} disabled={resolving || !canResolveReport(report.status)}
                    checked={checked.some((item) => item.id === report.id)}
                    onChange={(event) => { play('selection'); setCheckedIds((ids) => event.target.checked ? [...ids, report.id] : ids.filter((id) => id !== report.id)); }} />
                </label>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-controls="admin-report-detail"
                  onClick={() => { play('selection');  setSelectedId(report.id); }}
                  style={{ display: 'block', flex: 1, minWidth: 0, width: '100%', minHeight: 64, padding: '8px 12px', textAlign: 'left', cursor: 'pointer',
                    border: 'none', borderBottom: `1px solid ${Colors.admin.line}`, borderLeft: `3px solid ${active ? Colors.admin.navy : 'transparent'}`,
                  background: active ? Colors.admin.backgroundSelected : Colors.admin.card, color: Colors.admin.text, font: 'inherit' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{displayName(profiles.get(report.reported_user_id), report.reported_user_id)}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 99, color: report.status === 'open' ? Colors.admin.accent : Colors.admin.textSecondary, background: report.status === 'open' ? Colors.admin.backgroundSelected : Colors.admin.backgroundElement }}>{reportStatusLabel(report.status)}</span>
                  </span>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4, fontSize: 12, color: Colors.admin.textSecondary }}>{report.source === 'block' ? '직접 차단' : reportReasonLabel(report.reason_code)} · {report.blocked_at ? '차단 동반 · ' : ''}{reportTargetLabel(report.target_type)} · {formatDate(report.created_at)}</span>
                  {!!(report.details || report.evidence?.body || report.evidence?.title) && <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, fontSize: 12 }}>{report.details || report.evidence?.body || report.evidence?.title}</span>}
                </button>
                </div>
              );
            })}
          </div>

          {selected && (
            compact ? (
              <div className="admin-detail-sheet" role="dialog" aria-label="신고 상세">
                <div className="admin-detail-sheet-head">
                  <button type="button" className="admin-reset" onClick={() => { play('selection'); return setSelectedId(null); }}>‹ 목록으로</button>
                  <h2>신고 상세</h2>
                  <StatusPill status={selected.status} />
                </div>
                <div className="admin-detail-sheet-body">
                  <View style={styles.sheetInner}>
                    {detailFields(selected)}
                    {canResolveReport(selected.status)
                      ? <View style={styles.resolveBox}><ThemedText type="smallBold">처리 메모</ThemedText>{noteInput}</View>
                      : <LabelValue label="처리 기록" value={processedRecord(selected, action)} />}
                  </View>
                </div>
                {canResolveReport(selected.status) && <div className="admin-detail-sheet-actions">{resolveButtons(selected, true)}</div>}
              </div>
            ) : (
              <View nativeID="admin-report-detail" style={styles.detail}>
                <View style={styles.rowTop}>
                  <ThemedText type="subtitle" accessibilityRole="header" style={{ fontSize: 17, lineHeight: 24 }}>신고 상세</ThemedText>
                  <StatusPill status={selected.status} />
                </View>
                {detailFields(selected)}
                {canResolveReport(selected.status) ? (
                  <View style={styles.resolveBox}>
                    <ThemedText type="smallBold">처리 메모</ThemedText>
                    {noteInput}
                    <View style={styles.actions}>{resolveButtons(selected)}</View>
                  </View>
                ) : (
                  <LabelValue label="처리 기록" value={processedRecord(selected, action)} />
                )}
              </View>
            )
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

function processedRecord(report: AdminReport, action: AdminModerationAction | null | undefined) {
  const label = action ? ({ hidden: '콘텐츠 전체 숨김', blocked: '계정 정지', warned: '경고', dismissed: '기각' }[action.action]) : reportStatusLabel(report.status);
  return `${label}${action?.note ? ` · ${action.note}` : ''}`;
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
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  detail: { width: 380, maxWidth: '100%', padding: Spacing.four, gap: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  sheetInner: { padding: Spacing.four, gap: Spacing.three },
  muted: { color: Colors.admin.textSecondary },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: Colors.admin.backgroundElement },
  statusOpen: { backgroundColor: Colors.admin.backgroundSelected },
  statusText: { fontSize: 11, color: Colors.admin.textSecondary },
  statusTextOpen: { color: Colors.admin.accent },
  labelValue: { gap: Spacing.one },
  label: { color: Colors.admin.textSecondary },
  resolveBox: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, borderTopColor: Colors.admin.line },
  noteInput: { minHeight: 92, padding: Spacing.three, textAlignVertical: 'top', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, color: Colors.admin.text, backgroundColor: Colors.admin.background },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  outlineButton: { minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  primaryButton: { minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: Colors.admin.accent },
  dangerButton: { minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#EED3D9', backgroundColor: Colors.admin.dangerBackground },
  primaryText: { color: Colors.admin.accentInk },
  dangerText: { color: Colors.admin.danger },
  disabled: { opacity: 0.55 },
  empty: { minHeight: 180, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
});

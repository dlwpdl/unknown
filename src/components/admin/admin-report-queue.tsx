import { AdminTrustReviewContent, isTrustTarget } from '@/components/admin/admin-trust-review-content';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View, type ViewStyle } from 'react-native';

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
import { AdminButton, AdminCard, AdminDock, AdminFacts, AdminInfo, AdminMoreMenu, AdminPill, AdminTrace } from '@/components/admin/admin-ui';

import { AdminFilterBar, AdminFilterReset, AdminMultiFilter, AdminSearch, AdminTableSummary } from './admin-table-controls';
import { filterReportRows } from './admin-report-filter';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminMerchantReviewReplyContent } from '@/components/admin/admin-merchant-review-reply-content';

const REPORT_FILTERS = ['open', 'actioned', 'dismissed'].map((value) => ({ value, label: reportStatusLabel(value as AdminReport['status']) }));
const TARGET_FILTERS = ['user', 'post', 'comment', 'message', 'merchant_review', 'merchant_review_reply'].map((value) => ({ value, label: reportTargetLabel(value) }));
const ACTION_LABELS: Record<AdminModerationAction['action'], string> = { hidden: '콘텐츠 전체 숨김', blocked: '계정 정지', warned: '경고', dismissed: '기각' };
const A = Colors.admin;

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
  const [detailOpen, setDetailOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState({ reportId: '', text: '' });
  const [evidenceTab, setEvidenceTab] = useState<'now' | 'captured'>('now');
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
  const checkedHasUser = checked.some((report) => report.target_type === 'user');
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

  if (reports.length === 0) return <EmptyState text="접수된 신고가 없어요." />;

  // 같은 대상·이전 조치는 지금 불러온 신고만 기준으로 센다(ⓘ에 안내).
  const sameTarget = (report: AdminReport) => reports.filter((item) => item.target_type === report.target_type && item.target_id === report.target_id);
  const reporterCount = (report: AdminReport) => new Set(sameTarget(report).map((item) => item.reporter_id)).size;
  const priorActions = (report: AdminReport) => {
    const ids = new Set(reports.filter((item) => item.reported_user_id === report.reported_user_id && item.id !== report.id).map((item) => item.id));
    const counts = new Map<string, number>();
    for (const item of actions) if (ids.has(item.report_id) && item.action !== 'dismissed') counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
    return [...counts].map(([kind, count]) => `${ACTION_LABELS[kind as AdminModerationAction['action']]} ${count}회`).join(' · ') || '없음';
  };
  const reportTitle = (report: AdminReport) => report.source === 'block' ? '직접 차단' : `${reportReasonLabel(report.reason_code)} 신고`;
  const statusTone = (status: AdminReport['status']) => status === 'open' ? 'warning' as const : status === 'actioned' ? 'success' as const : 'neutral' as const;

  const noteInput = (
    <TextInput
      value={note}
      onChangeText={setNote}
      placeholder="판단 근거 메모 (처리 기록에 남아요)"
      placeholderTextColor={A.textSecondary}
      multiline
      maxLength={1000}
      onFocus={() => play('selection')}
      accessibilityLabel="신고 처리 메모"
      style={[styles.noteInput, compact && styles.noteInputCompact]}
    />
  );

  // 근거를 다 읽은 뒤 결정하도록 처리줄은 상세 맨 아래에 고정한다. 실행 확인 창은 onResolve(admin-screen)가 띄운다.
  const dock = (report: AdminReport) => canResolveReport(report.status) ? (
    <AdminDock>
      <View style={styles.dockNote}>{noteInput}</View>
      <AdminButton label="기각" disabled={resolving} onPress={() => void onResolve(report.id, 'dismissed', note)} />
      <AdminButton label={resolving ? '처리 중' : '경고'} accessibilityLabel="경고" disabled={resolving} onPress={() => void onResolve(report.id, 'warned', note)} />
      <View style={styles.grow} />
      {report.target_type !== 'user' && <AdminButton kind="danger" label="숨김" accessibilityLabel="콘텐츠 전체 숨김" disabled={resolving}
        onPress={() => void onResolve(report.id, 'hidden', note)} />}
      <AdminButton kind="danger" label={compact ? '정지' : '계정 정지'} accessibilityLabel="계정 정지" disabled={resolving}
        onPress={() => void onResolve(report.id, 'blocked', note)} />
    </AdminDock>
  ) : null;

  const detailInfo = (report: AdminReport) => [
    report.blocked_at ? '신고자에게는 작성자 콘텐츠가 숨겨져 있어요. 다른 회원에게 보일지는 운영 조치로 정해요.'
      : report.target_type === 'user' ? '사용자 검토 요청이에요. 자동으로 전부 숨기지는 않아요.'
      : '신고자에게만 이 콘텐츠가 숨겨져 있어요. 다른 회원에게 보일지는 운영 조치로 정해요.',
    '신고·차단은 위반이 확정됐다는 뜻이 아니에요. 전체 숨김은 공개만 멈추고 원문과 처리 기록은 보존 정책에 따라 보관해요.',
    '같은 대상 신고와 이전 조치는 지금 불러온 신고 기준이에요.',
    ...(isTrustTarget(report.target_type) ? ['지금 내용은 별도 권한 확인 후 조회해요.'] : []),
  ];

  const currentContent = (report: AdminReport): ReactNode => {
    if (isTrustTarget(report.target_type)) return <AdminTrustReviewContent targetType={report.target_type} targetId={report.target_id} localPreview={localPreview} onUser={onUser} />;
    if (report.target_type === 'merchant_review') return <AdminMerchantReviewContent targetId={report.target_id} localPreview={localPreview} onUser={onUser} />;
    if (report.target_type === 'merchant_review_reply') return <AdminMerchantReviewReplyContent targetId={report.target_id} localPreview={localPreview} onUser={onUser} />;
    return null;
  };

  const capturedContent = (report: AdminReport) => (
    <View style={styles.block}>
      <LabelValue label="접수 당시 원본" value={report.evidence
        ? [report.evidence.title, report.evidence.body, report.evidence.nickname].filter(Boolean).join('\n') || '텍스트 없음'
        : '이 신고에는 접수 당시 원문이 저장되지 않았어요. 작성자 활동에서 확인해 주세요.'} />
      {report.target_type === 'merchant_review' && <LabelValue label="접수 당시 비즈니스 후기" value={`${report.evidence?.merchant_name ?? report.evidence?.merchant_id ?? '비즈니스 정보 없음'}${report.evidence?.score == null ? '' : ` · ${report.evidence.score}/10`}${report.evidence?.status ? ` · ${report.evidence.status === 'removed' ? '숨김' : '게시 중'}` : ''}`} />}
      {report.target_type === 'merchant_review_reply' && <LabelValue label="접수 당시 비즈니스" value={report.evidence?.merchant_name ?? report.evidence?.merchant_id ?? '비즈니스 정보 없음'} />}
    </View>
  );

  // 순서: 사실 4칸 → 신고된 내용 → 신고 이력 → 추적 정보. 처리줄(dock)은 이 아래에 붙는다.
  const detailBody = (report: AdminReport) => {
    const current = currentContent(report);
    const tab = current ? evidenceTab : 'captured';
    const reporters = reporterCount(report);
    return (
      <>
        <AdminFacts columns={2} items={[
          { label: '작성자', value: displayName(profiles.get(report.reported_user_id), report.reported_user_id) },
          { label: '대상', value: `${reportTargetLabel(report.target_type)}${report.blocked_at ? ' · 차단 동반' : ''}` },
          { label: '같은 대상 신고', value: `${reporters}명`, tone: reporters > 1 ? 'warning' : undefined },
          { label: '작성자 이전 조치', value: priorActions(report) },
        ]} />
        {!canResolveReport(report.status) && <LabelValue label="처리 기록" value={processedRecord(report, action)} />}
        <View style={styles.block}>
          {current ? (
            <div className="admin-status-tabs" role="group" aria-label="신고된 내용 보기">
              {([['now', '지금 내용'], ['captured', '접수 당시']] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={tab === value} onClick={() => { play('selection'); setEvidenceTab(value); }}>{label}</button>
              ))}
            </div>
          ) : <ThemedText type="small" style={styles.muted}>신고된 내용</ThemedText>}
          {/* 감사 기록이 남는 원문 조회를 탭 전환마다 다시 하지 않도록 두 탭 모두 마운트해 둔다. */}
          {current && <View style={tab === 'now' ? null : styles.hidden}>{current}</View>}
          <View style={tab === 'captured' ? null : styles.hidden}>{capturedContent(report)}</View>
        </View>
        <View style={styles.block}>
          <ThemedText type="small" style={styles.muted}>신고자가 남긴 말</ThemedText>
          {sameTarget(report).map((item) => (
            <ThemedText key={item.id}>
              {`${item.details ? `"${item.details}"` : item.source === 'block' ? '직접 차단' : '남긴 말 없음'} · ${displayName(profiles.get(item.reporter_id), item.reporter_id)} · ${formatDate(item.created_at)}`}
            </ThemedText>
          ))}
        </View>
        <AdminTrace items={[
          { label: '신고 ID', value: report.id },
          { label: '대상 ID', value: report.target_id },
          { label: '신고자 ID', value: report.reporter_id },
          ...(report.evidence?.image_paths?.length ? [{ label: '첨부 원본 경로', value: report.evidence.image_paths.join('\n') }] : []),
        ]} />
      </>
    );
  };

  const authorButton = (report: AdminReport) => (
    <AdminButton kind="text" label="작성자 활동 →" accessibilityLabel="작성자 전체 활동 보기" onPress={() => onUser(report.reported_user_id)} />
  );

  return (
    // Keep the compact detail above pagination rendered beside this queue.
    <View style={[styles.queue, compact && detailOpen && selected && { zIndex: 1 }]}>
      <div className="admin-status-tabs" role="group" aria-label="신고 상태">
        {[...REPORT_FILTERS.map((option) => ({ value: option.value, label: `${option.label} ${reports.filter((report) => report.status === option.value).length}` })),
          { value: '', label: `전체 ${reports.length}` }].map((option) => (
          <button key={option.value || 'all'} type="button"
            aria-pressed={option.value === '' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === option.value}
            onClick={() => { play('selection'); setStatuses(option.value ? [option.value] : []); setCheckedIds([]); }}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <AdminSearch value={query} onChange={(value) => { setQuery(value); setCheckedIds([]); }} placeholder="사용자, 신고 내용, 사유 검색" />
        {/* 상태는 위 탭에서만 거른다. 필터 메뉴에는 대상 종류만 둔다. */}
        <AdminFilterBar applied={targets.length}>
          <div className="admin-filter-row">
            <AdminMultiFilter label="대상" options={TARGET_FILTERS} value={targets} onChange={(value) => { setTargets(value); setCheckedIds([]); }} />
            <AdminFilterReset disabled={!query && !targets.length} onReset={() => { setQuery(''); setTargets([]); setCheckedIds([]); }} />
          </div>
        </AdminFilterBar>
        <AdminTableSummary shown={visibleReports.length} loaded={reports.length} />
      </div>

      {visibleReports.length === 0 ? <EmptyState text="검색 조건에 맞는 신고가 없어요." /> : (
        <View style={styles.split}>
          <div style={{ flex: 1, minWidth: 280, border: `1px solid ${A.line}`, borderRadius: 14, background: A.card }} aria-label="신고 목록">
            {/* 일괄 처리 띠는 하나라도 고르면 그때 나타난다. */}
            <fieldset disabled={resolving} style={{ margin: 0, padding: '4px 12px', border: 'none', borderBottom: `1px solid ${A.line}`, borderRadius: '14px 14px 0 0', minWidth: 0,
              background: checked.length ? A.backgroundSelected : A.card, display: 'grid', gap: 4, fontSize: 13 }}>
              <div className="admin-filter-row">
                <label className="admin-report-check"><input type="checkbox" checked={allChecked} aria-label="보이는 미처리 신고 전체 선택"
                  ref={(element) => { if (element) element.indeterminate = checked.length > 0 && !allChecked; }}
                  disabled={!selectable.length || resolving}
                  onChange={(event) => { play('selection'); setCheckedIds(event.target.checked ? selectable.map((report) => report.id) : []); }} /></label>
                <span aria-live="polite" style={{ fontWeight: checked.length ? 700 : 400, color: checked.length ? A.text : A.textSecondary }}>
                  {checked.length ? `${checked.length}건 선택` : '미처리 전체 선택'}
                </span>
                {checked.length > 0 && <>
                  <span style={{ flex: 1 }} />
                  <AdminButton label="기각" accessibilityLabel="선택 기각" disabled={resolving} onPress={() => void resolveChecked('dismissed')} />
                  <AdminButton label="경고" accessibilityLabel="선택 경고" disabled={resolving} onPress={() => void resolveChecked('warned')} />
                  <AdminMoreMenu label="선택한 신고 다른 처리" items={[
                    { label: '선택 계정 정지', danger: true, disabled: resolving, onPress: () => void resolveChecked('blocked') },
                    { label: '선택 콘텐츠 전체 숨김', danger: true, disabled: resolving || checkedHasUser, onPress: () => void resolveChecked('hidden') },
                    { label: '선택 해제', onPress: () => setCheckedIds([]) },
                  ]} />
                  <AdminInfo label="일괄 처리 안내" text={[
                    '선택한 신고마다 처리 기록과 메모가 남아요. 같은 회원 신고가 여러 건이면 경고·정지 알림도 신고마다 가요.',
                    ...(checkedHasUser ? ['콘텐츠 전체 숨김은 게시글·댓글·메시지·비즈니스 후기 신고만 골랐을 때 쓸 수 있어요.'] : []),
                  ]} />
                </>}
              </div>
              {checked.length > 0 && (
                <textarea aria-label="일괄 처리 메모" value={bulkNote} maxLength={1000} rows={1} onFocus={() => play('selection')}
                  onChange={(event) => setBulkNote(event.target.value)} placeholder="선택한 신고에 같이 남길 판단 근거"
                  style={{ boxSizing: 'border-box', width: '100%', minHeight: 44, marginBottom: 8, padding: 10, font: 'inherit', color: A.text, background: A.card, border: `1px solid ${A.line}`, borderRadius: 8 }} />
              )}
            </fieldset>
            {visibleReports.map((report) => {
              const active = report.id === selected?.id;
              const name = displayName(profiles.get(report.reported_user_id), report.reported_user_id);
              const reporters = reporterCount(report);
              return (
                <div key={report.id} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${A.line}`, background: active ? A.backgroundSelected : 'transparent' }}>
                  <label className="admin-report-check" style={{ flexShrink: 0 }}>
                    <input type="checkbox" aria-label={`${name} · ${reportReasonLabel(report.reason_code)} 신고 선택`} disabled={resolving || !canResolveReport(report.status)}
                      checked={checked.some((item) => item.id === report.id)}
                      onChange={(event) => { play('selection'); setCheckedIds((ids) => event.target.checked ? [...ids, report.id] : ids.filter((id) => id !== report.id)); }} />
                  </label>
                  <button
                    id={`admin-report-row-${report.id}`}
                    type="button"
                    aria-pressed={active}
                    aria-controls="admin-report-detail"
                    onClick={() => { play('selection'); setSelectedId(report.id); setDetailOpen(true); }}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0, minHeight: 64, padding: '10px 12px 10px 0', textAlign: 'left', cursor: 'pointer',
                      border: 'none', background: 'transparent', color: A.text, font: 'inherit' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 }}>
                        {report.details || report.evidence?.body || report.evidence?.title || name}
                      </span>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4, fontSize: 12, color: A.textSecondary }}>
                        <span style={{ padding: '1px 6px', marginRight: 6, borderRadius: 99, background: A.backgroundElement, color: A.text }}>{report.source === 'block' ? '직접 차단' : reportReasonLabel(report.reason_code)}</span>
                        {name} · {reportTargetLabel(report.target_type)}{report.blocked_at ? ' · 차단 동반' : ''}{reporters > 1 ? ` · 신고 ${reporters}명` : ''}
                      </span>
                    </span>
                    <span style={{ flexShrink: 0, textAlign: 'right', fontSize: 11, color: A.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(report.created_at)}
                      {report.status !== 'open' && <span style={{ display: 'block', marginTop: 4 }}>{reportStatusLabel(report.status)}</span>}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {selected && (
            compact ? (
              <div id="admin-report-detail" className="admin-detail-sheet" hidden={!detailOpen} style={detailOpen ? undefined : { display: 'none' }} role={detailOpen ? 'dialog' : undefined} aria-label="신고 상세">
                <div className="admin-detail-sheet-head">
                  <button type="button" className="admin-reset" onClick={() => { play('selection'); setDetailOpen(false); document.getElementById(`admin-report-row-${selected.id}`)?.focus(); }}>‹ 목록으로</button>
                  <h2>{reportTitle(selected)}</h2>
                  <AdminPill label={reportStatusLabel(selected.status)} tone={statusTone(selected.status)} />
                </div>
                {/* 하단 고정 처리줄이 시트 안에서 붙도록 기존 하단 여백을 뺀다. */}
                <div className="admin-detail-sheet-body" style={{ paddingBottom: 0 }}>
                  <View style={styles.sheetInner}>
                    <View style={styles.authorRow}><AdminInfo text={detailInfo(selected)} />{authorButton(selected)}</View>
                    {detailBody(selected)}
                  </View>
                </div>
                {dock(selected)}
              </div>
            ) : (
              <View nativeID="admin-report-detail" style={styles.detail}>
                <AdminCard title={reportTitle(selected)} tone={statusTone(selected.status)} info={detailInfo(selected)}
                  // overflow:clip keeps the rounded corners without becoming a scroll container, so the dock can stick.
                  style={{ overflow: 'clip' } as unknown as ViewStyle}
                  action={<View style={styles.headActions}><AdminPill label={reportStatusLabel(selected.status)} tone={statusTone(selected.status)} />{authorButton(selected)}</View>}>
                  {detailBody(selected)}
                  {dock(selected)}
                </AdminCard>
              </View>
            )
          )}
        </View>
      )}
    </View>
  );
}

function processedRecord(report: AdminReport, action: AdminModerationAction | null | undefined) {
  const label = action ? ACTION_LABELS[action.action] : reportStatusLabel(report.status);
  return `${label}${action?.note ? ` · ${action.note}` : ''}`;
}

function LabelValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.labelValue}><ThemedText type="small" style={styles.muted}>{label}</ThemedText><ThemedText>{value}</ThemedText></View>;
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
  detail: { width: 440, maxWidth: '100%' },
  sheetInner: { padding: Spacing.four, gap: Spacing.three },
  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  block: { gap: Spacing.two },
  hidden: { display: 'none' },
  grow: { flexGrow: 1 },
  muted: { color: A.textSecondary },
  labelValue: { gap: Spacing.one },
  dockNote: { flexBasis: '100%' },
  noteInput: { minHeight: 64, padding: Spacing.three, textAlignVertical: 'top', borderWidth: 1, borderColor: A.line, borderRadius: 8, color: A.text, backgroundColor: A.background },
  noteInputCompact: { minHeight: 48 },
  empty: { minHeight: 180, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: A.line, borderRadius: 10, backgroundColor: A.card },
});

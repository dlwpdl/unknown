export type ReportStatus = 'open' | 'actioned' | 'dismissed';
export type ReportFilter = 'all' | ReportStatus;
export type AdminSection = 'overview' | 'safety' | 'reports' | 'users' | 'posts' | 'conversations';

const REPORT_REASON_LABELS: Record<string, string> = {
  spam: '스팸',
  harassment: '괴롭힘',
  hate: '혐오 표현',
  sexual: '성적 콘텐츠',
  privacy: '개인정보 침해',
  other: '기타',
};

const REPORT_TARGET_LABELS: Record<string, string> = {
  user: '사용자',
  post: '게시글',
  comment: '댓글',
  message: '메시지',
};

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'overview', label: '현황' },
  { id: 'safety', label: 'AI 안전' },
  { id: 'reports', label: '신고' },
  { id: 'users', label: '사용자' },
  { id: 'posts', label: '게시글' },
  { id: 'conversations', label: '대화' },
];

export function canUseLocalAdminPreview(dev: boolean, hostname: string) {
  return dev && ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export function isAdminRole(appMetadata: Record<string, unknown> | null | undefined) {
  return appMetadata?.role === 'admin';
}

export function canResolveReport(status: ReportStatus) {
  return status === 'open';
}

export function reportStatusLabel(status: ReportStatus) {
  return {
    open: '미처리',
    actioned: '조치함',
    dismissed: '기각',
  }[status];
}

export function reportReasonLabel(reason: string) {
  return REPORT_REASON_LABELS[reason] ?? reason;
}

export function reportTargetLabel(target: string) {
  return REPORT_TARGET_LABELS[target] ?? target;
}

export function filterAdminReports<T extends { status: ReportStatus }>(reports: readonly T[], filter: ReportFilter) {
  return (filter === 'all' ? [...reports] : reports.filter((report) => report.status === filter))
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
}

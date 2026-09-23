export type ReportStatus = 'open' | 'actioned' | 'dismissed';
export type ReportFilter = 'all' | ReportStatus;
export type AdminSection = 'analytics' | 'overview' | 'safety' | 'alerts' | 'trending' | 'errors' | 'reports' | 'users' | 'posts' | 'conversations';

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
  { id: 'analytics', label: '분석' },
  { id: 'overview', label: '현황' },
  { id: 'safety', label: 'AI 안전' },
  { id: 'alerts', label: '감시어 경보' },
  { id: 'trending', label: '뜨는 글 알림' },
  { id: 'errors', label: '앱 오류' },
  { id: 'reports', label: '신고' },
  { id: 'users', label: '사용자' },
  { id: 'posts', label: '게시글' },
  { id: 'conversations', label: '대화' },
];

// 지켜보는 화면 / 처리하는 화면 / 규모를 보는 화면으로 나눈다. 미처리 배지는 '대응' 그룹에서 먼저 보인다.
export const ADMIN_NAV_GROUPS: { label: string; sections: AdminSection[] }[] = [
  { label: '모니터링', sections: ['analytics', 'overview', 'safety', 'alerts', 'trending'] },
  { label: '대응', sections: ['reports', 'errors'] },
  { label: '데이터', sections: ['users', 'posts', 'conversations'] },
];

// 0건이어도 표시해 "확인했다"는 신호를 주는 항목.
export const ADMIN_COUNTED_SECTIONS: AdminSection[] = ['reports', 'safety', 'alerts'];

export function canUseLocalAdminPreview(dev: boolean, hostname: string) {
  return dev && ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

// React Native Web exposes these groups as divs, so provide their native keyboard behavior.
export function adminOptionKeys(event: { key: string; currentTarget: HTMLElement; preventDefault: () => void }) {
  if (event.key === ' ') { event.preventDefault(); event.currentTarget.click(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const options = Array.from(event.currentTarget.closest('[role="tablist"], [role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="tab"], [role="radio"]') ?? []);
  if (!options.length) return;
  event.preventDefault();
  const index = options.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + options.length) % options.length;
  options[next].focus();
  options[next].click();
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

import type { KeyDownEvent } from 'react-native';

export type ReportStatus = 'open' | 'actioned' | 'dismissed';
export type ReportFilter = 'all' | ReportStatus;
export type AdminSection = 'analytics' | 'webshops' | 'ticketmaster' | 'merchants' | 'creators' | 'campaigns' | 'benefits' | 'meetups' | 'overview' | 'safety' | 'alerts' | 'trending' | 'errors' | 'reports' | 'users' | 'posts' | 'conversations';

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
  merchant_review: '비즈니스 후기',
  merchant_review_reply: '비즈니스 답변',
  meetup_review: '모임 후기',
  manner_review: '비공개 매너 평가',
  meetup_attendance: '참석 이의제기',
};

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'analytics', label: '분석' },
  { id: 'webshops', label: '웹샵 성과' },
  { id: 'ticketmaster', label: 'Ticketmaster 수익' },
  { id: 'merchants', label: '비즈니스 관리' },
  { id: 'creators', label: '크리에이터' },
  { id: 'campaigns', label: '협업 캠페인' },
  { id: 'benefits', label: '혜택·쿠폰' },
  { id: 'overview', label: '현황' },
  { id: 'safety', label: 'AI 안전' },
  { id: 'alerts', label: '감시어 경보' },
  { id: 'trending', label: '뜨는 글 알림' },
  { id: 'errors', label: '앱 오류' },
  { id: 'reports', label: '신고' },
  { id: 'users', label: '사용자' },
  { id: 'posts', label: '게시글' },
  { id: 'meetups', label: '모임' },
  { id: 'conversations', label: '대화' },
];

export function initialAdminSection(requested?: string, alert?: string, safety?: string): AdminSection {
  return ADMIN_SECTIONS.find((entry) => entry.id === requested)?.id ?? (alert ? 'alerts' : safety ? 'safety' : 'overview');
}

// The Supabase SDK wraps its SVG in a data URI; encode only the SVG, including color # characters.
export const adminTotpQrUri = (qr: string) => `data:image/svg+xml;utf8,${encodeURIComponent(qr.replace(/^data:image\/svg\+xml;utf-8,/, ''))}`;

// 운영 현황 다음에 대응할 신호와 전체 활동을 찾을 수 있게 묶는다.
export const ADMIN_NAV_GROUPS: { label: string; sections: AdminSection[] }[] = [
  { label: '운영', sections: ['overview', 'analytics'] },
  { label: '안전 검토', sections: ['reports', 'safety', 'alerts', 'errors'] },
  { label: '콘텐츠·회원', sections: ['users', 'posts', 'meetups', 'conversations', 'trending'] },
  { label: '제휴 운영', sections: ['merchants', 'creators', 'campaigns', 'benefits'] },
  { label: '수익', sections: ['webshops', 'ticketmaster'] },
];

// 0건이어도 표시해 "확인했다"는 신호를 주는 항목.
export const ADMIN_COUNTED_SECTIONS: AdminSection[] = ['reports', 'safety', 'alerts'];

export function canUseLocalAdminPreview(dev: boolean, hostname: string) {
  return dev && ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

// React Native Web exposes these groups as divs, so provide their native keyboard behavior.
export function adminOptionKeys(event: KeyDownEvent | { key: string; currentTarget: HTMLElement; preventDefault: () => void }) {
  const key = 'key' in event ? event.key : event.nativeEvent.key;
  const target = event.currentTarget as HTMLElement;
  if (key === ' ') { event.preventDefault(); target.click(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
  const options = Array.from(target.closest('[role="tablist"], [role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="tab"], [role="radio"]') ?? []);
  if (!options.length) return;
  event.preventDefault();
  const index = options.indexOf(target);
  const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(key) ? -1 : 1) + options.length) % options.length;
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

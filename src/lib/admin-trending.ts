// "지금 뜨는 글" 알림 설정. 점수 값은 운영하면서 바뀌므로 대시보드에서 직접 조정한다.
export type AdminTrendingConfig = {
  enabled: boolean;
  view_weight: number; anon_view_weight: number; like_weight: number; comment_weight: number;
  half_life_hours: number; min_score: number; max_age_hours: number; max_per_city_per_day: number;
  quiet_start_hour: number; quiet_end_hour: number; timezone: string;
  updated_at: string; updated_by: string | null;
};
export type AdminTrendingCandidate = {
  post_id: string; city_id: string; title: string; score: number;
  authed_views: number; anon_views: number; like_count: number; comment_count: number; created_at: string;
};
export type AdminTrendingSent = { postId: string; cityId: string; title: string; score: number; recipients: number; sentAt: string };
export type AdminTrendingState = {
  config: AdminTrendingConfig; quietNow: boolean;
  preview: AdminTrendingCandidate[]; recent: AdminTrendingSent[];
};

// 입력칸의 문자열을 저장할 값으로 바꾼다. 0 이하가 들어가면 DB 제약이 막지만
// 그때는 원인을 알 수 없는 오류로 보이므로 여기서 먼저 걸러 어떤 칸인지 돌려준다.
export const TRENDING_POSITIVE_KEYS = ['half_life_hours', 'max_age_hours'] as const;

export function trendingConfigPatch(
  draft: Record<string, string>,
  current: AdminTrendingConfig,
): { patch: Partial<AdminTrendingConfig> } | { invalid: string } {
  const patch: Record<string, number> = {};
  for (const [key, text] of Object.entries(draft)) {
    const value = Number(text.trim());
    if (text.trim() === '' || !Number.isFinite(value) || value < 0) return { invalid: key };
    if ((TRENDING_POSITIVE_KEYS as readonly string[]).includes(key) && value <= 0) return { invalid: key };
    if (value !== current[key as keyof AdminTrendingConfig]) patch[key] = value;
  }
  return { patch: patch as Partial<AdminTrendingConfig> };
}

// 노출을 좌우하는 값은 어드민만 조정한다. 작성자에게는 컬럼 권한 자체가 없다.
export type AdminPostPatch = { view_count?: number; sort_at?: string; hashtags?: string[]; status?: 'published' | 'removed' };
export type AdminPostFields = { id: string; status: string; viewCount: number; sortAt: string; hashtags: string[]; deletedAt: string | null };

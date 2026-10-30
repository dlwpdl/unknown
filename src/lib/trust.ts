import type { SupabaseClient } from '@supabase/supabase-js';

// 1 계정 확인(소셜 로그인 + 문자 인증), 2 신분증 확인, 3 믿을 수 있는 호스트(Lv2 + 모임 기준, 서버가 자동 판정).
export type TrustLevel = 1 | 2 | 3;

export function shouldCelebrateVerificationUpgrade(previous: string | null, current: TrustLevel): boolean {
  const level = Number(previous);
  return previous !== null && [1, 2, 3].includes(level) && current > level;
}

export function trustLevelOf({
  verified,
  trustLevel,
}: {
  verified?: boolean;
  trustLevel?: 2 | 3;
}): TrustLevel {
  return trustLevel ?? (verified ? 2 : 1);
}

// get_my_trust_progress: the signed-in member's own Lv3 record. Never another account's.
export type TrustProgress = {
  enabled: boolean;
  level: number;
  eligible: boolean;
  confirmedMeetups: { required: number; count: number };
  hostedMeetups: { required: number; count: number };
  noRecentNoShow: { days: number; met: boolean };
  goodConduct: { days: number; met: boolean };
};

export type TrustedHostStep =
  | { key: 'level'; met: boolean }
  | { key: 'confirmed'; met: boolean; count: number; required: number }
  | { key: 'hosted'; met: boolean; count: number; required: number }
  | { key: 'noShow'; met: boolean; days: number }
  | { key: 'conduct'; met: boolean; days: number };

export async function loadMyTrustProgress(client: SupabaseClient): Promise<TrustProgress> {
  const { data, error } = await client.rpc('get_my_trust_progress');
  if (error) throw new Error(error.message);
  return data as TrustProgress;
}

// A check the server switched off (0) is left out instead of showing as met.
export function trustedHostSteps(progress: TrustProgress): TrustedHostStep[] {
  const { confirmedMeetups: confirmed, hostedMeetups: hosted, noRecentNoShow: noShow, goodConduct: conduct } = progress;
  const steps: TrustedHostStep[] = [
    { key: 'level', met: progress.level >= 2 },
    { key: 'confirmed', met: confirmed.count >= confirmed.required, count: confirmed.count, required: confirmed.required },
  ];
  if (hosted.required > 0) steps.push({ key: 'hosted', met: hosted.count >= hosted.required, count: hosted.count, required: hosted.required });
  if (noShow.days > 0) steps.push({ key: 'noShow', met: noShow.met, days: noShow.days });
  if (conduct.days > 0) steps.push({ key: 'conduct', met: conduct.met, days: conduct.days });
  return steps;
}

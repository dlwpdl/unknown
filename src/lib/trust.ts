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

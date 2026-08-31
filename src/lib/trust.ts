export type TrustLevel = 1 | 2 | 3;

export function trustLevelOf({
  verified,
  trustLevel,
}: {
  verified?: boolean;
  trustLevel?: 2 | 3;
}): TrustLevel {
  return trustLevel ?? (verified ? 2 : 1);
}

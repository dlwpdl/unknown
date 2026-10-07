export function requiresAppUpdate(build: string | null, minimumBuild: unknown): boolean {
  return typeof build === 'string' && /^\d+$/.test(build)
    && typeof minimumBuild === 'number' && Number.isSafeInteger(minimumBuild)
    && Number(build) < minimumBuild;
}

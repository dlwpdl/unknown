// Each report keeps the existing server transaction, authorization and audit trail.
export async function resolveReportBatch(ids: readonly string[], resolve: (id: string) => Promise<void>) {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of new Set(ids)) {
    try { await resolve(id); succeeded.push(id); }
    catch { failed.push(id); }
  }
  return { succeeded, failed };
}

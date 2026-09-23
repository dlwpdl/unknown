export function filterReportRows<T extends { status: string; target_type: string; searchText: string }>(
  reports: readonly T[], query: string, statuses: readonly string[], targets: readonly string[],
): T[] {
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  return reports.filter((report) =>
    (!statuses.length || statuses.includes(report.status)) &&
    (!targets.length || targets.includes(report.target_type)) &&
    (!needle || report.searchText.toLocaleLowerCase('ko-KR').includes(needle)))
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
}

// 운영 콘솔의 좁은 화면 기준. 폰(약 390~440pt)에서는 내비·필터·표를 접고,
// 태블릿 가로(768pt 이상)부터 데스크톱과 같은 배치를 쓴다.
export const ADMIN_COMPACT_WIDTH = 700;
export const ADMIN_NARROW_WIDTH = 420;

export function isCompactAdminWidth(width: number) {
  return width < ADMIN_COMPACT_WIDTH;
}

export function isNarrowAdminWidth(width: number) {
  return width < ADMIN_NARROW_WIDTH;
}

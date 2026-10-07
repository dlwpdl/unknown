// 일력 칩 — "오늘"의 물성. Intl 의존 없이 수동 포맷 (Hermes 로케일 편차 회피)
export function todayLabel() {
  const now = new Date();
  const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 ${day}요일`;
}

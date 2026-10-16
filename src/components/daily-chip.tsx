import { getLocale } from '@/i18n';

export function todayLabel(locale = getLocale()) {
  const now = new Date();
  if (locale === 'en-CA') return now.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', weekday: 'long' });
  const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 ${day}요일`;
}

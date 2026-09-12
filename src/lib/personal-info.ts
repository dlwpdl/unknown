export const PERSONAL_INFO_VERSION = '2026-09-12';

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function ageOnDate(dateOfBirth: string, today = new Date().toISOString().slice(0, 10)): number | null {
  const birth = calendarDate(dateOfBirth), current = calendarDate(today);
  if (!birth || !current || dateOfBirth > today) return null;
  const earliest = new Date(current);
  earliest.setUTCFullYear(current.getUTCFullYear() - 120);
  if (earliest.getUTCMonth() !== current.getUTCMonth()) earliest.setUTCDate(0);
  if (birth < earliest) return null;
  return current.getUTCFullYear() - birth.getUTCFullYear() - (today.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
}

export function validatePersonalInfo(fullName: string, dateOfBirth: string, today?: string): string | null {
  const name = fullName.trim();
  if (!name && !dateOfBirth) return null;
  if (!name || !dateOfBirth) return '이름과 생년월일을 함께 입력해주세요.';
  if (Array.from(name).length > 200 || /\p{Cc}/u.test(name)) return '이름은 줄바꿈 없이 200자 이내로 입력해주세요.';
  if (ageOnDate(dateOfBirth, today) === null) return '생년월일을 YYYY-MM-DD 형식의 실제 날짜로 확인해주세요. 미래 또는 120년 이전 날짜는 입력할 수 없어요.';
  return null;
}

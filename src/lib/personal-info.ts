export const PERSONAL_INFO_VERSION = '2026-09-22';
// Older receipts stay valid: gender was added to the block without changing the name·birth-date purpose.
export const PERSONAL_INFO_VERSIONS = ['2026-09-19', '2026-09-22'];
export const PERSONAL_INFO_NOTICE = '이름은 비공개 계정 확인과 안전사건 대응에, 생년월일은 해당 목적과 모임의 권장 연령대 안내에, 성별은 비공개 계정 확인에 사용해요. 이름·생년월일·성별 원본은 다른 회원에게 공개하지 않으며 본인과 권한 있는 관리자만 볼 수 있어요. 설정에서 삭제하거나 탈퇴할 때까지 보관해요. 직접 입력한 내용은 실명·생년월일 인증 결과가 아니며, 입력하지 않아도 가입하거나 모임에 신청할 수 있어요.';
export const PERSONAL_INFO_GENDERS = { male: '남성', female: '여성', other: '기타' } as const;
export type PersonalInfoGender = keyof typeof PERSONAL_INFO_GENDERS;

export function ageForMeetupRecommendation(info: { date_of_birth?: string | null; consent_version?: string | null } | null, today?: string): number | null {
  const version = info?.consent_version;
  return version && PERSONAL_INFO_VERSIONS.includes(version) && info?.date_of_birth ? ageOnDate(info.date_of_birth, today) : null;
}

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

export function validatePersonalInfo(fullName: string, dateOfBirth: string, gender = '', today?: string): string | null {
  const name = fullName.trim();
  if (!name && !dateOfBirth) return gender ? '성별은 이름·생년월일과 함께 저장할 수 있어요. 이름과 생년월일을 입력하거나 성별 선택을 비워주세요.' : null;
  if (!name || !dateOfBirth) return '이름과 생년월일을 함께 입력해주세요.';
  if (Array.from(name).length > 200 || /\p{Cc}/u.test(name)) return '이름은 줄바꿈 없이 200자 이내로 입력해주세요.';
  if (ageOnDate(dateOfBirth, today) === null) return '생년월일을 YYYY-MM-DD 형식의 실제 날짜로 확인해주세요. 미래 또는 120년 이전 날짜는 입력할 수 없어요.';
  return null;
}

export function formatDateOfBirth(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

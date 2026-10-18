import type { SupabaseClient } from '@supabase/supabase-js';

export type NicknameLanguage = 'ko' | 'en';

export function normalizeNickname(value: string) {
  const nickname = value.trim();
  if ([...nickname].length < 2 || [...nickname].length > 20 || /[\u0000-\u001f\u007f]/u.test(nickname)) throw new Error('INVALID_NICKNAME');
  return nickname;
}

export async function changeProfileNickname(client: SupabaseClient, userId: string, value: string, expectedNickname: string): Promise<string> {
  const nickname = normalizeNickname(value);
  const { data, error } = await client.rpc('change_profile_nickname', { p_user_id: userId, p_nickname: nickname, p_expected_nickname: expectedNickname });
  if (error) throw new Error(error.code === '23505' ? 'NICKNAME_TAKEN' : error.message);
  if (data?.id !== userId || data.nickname !== nickname) throw new Error('NICKNAME_READBACK_REQUIRED');
  return data.nickname;
}

export function nicknameError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('INVALID_NICKNAME')) return '닉네임은 2~20자로 입력해 주세요.';
  if (code.includes('NICKNAME_TAKEN')) return '이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.';
  if (code.includes('NICKNAME_CHANGED')) return '닉네임이 다른 곳에서 바뀌었어요. 최신 이름을 확인한 뒤 다시 시도해 주세요.';
  return '변경 결과를 확인하지 못했어요. 최신 닉네임과 연결 상태를 확인해 주세요.';
}

const WORDS = {
  ko: {
    adjectives: ['고요한', '다정한', '느긋한', '용감한', '포근한', '반짝이는', '유쾌한', '푸른'],
    nouns: ['수달', '여우', '단풍', '고래', '참새', '달빛', '구름', '토끼'],
  },
  en: {
    adjectives: ['Calm', 'Kind', 'Mellow', 'Brave', 'Cozy', 'Bright', 'Jolly', 'Blue'],
    nouns: ['Otter', 'Fox', 'Maple', 'Whale', 'Sparrow', 'Moon', 'Cloud', 'Rabbit'],
  },
} as const;

export function generateNickname(language: NicknameLanguage, random = Math.random) {
  const words = WORDS[language];
  return `${pick(words.adjectives, random)}${pick(words.nouns, random)}`;
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

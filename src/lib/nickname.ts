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
    adjectives: [
      '고요한', '다정한', '느긋한', '용감한', '포근한', '반짝이는', '유쾌한', '푸른',
      '따뜻한', '차분한', '명랑한', '활기찬', '산뜻한', '싱그러운', '따스한', '빛나는',
      '부드러운', '온화한', '상냥한', '친절한', '씩씩한', '든든한', '재빠른', '지혜로운',
      '호기심많은', '꿈꾸는', '미소짓는', '노래하는', '춤추는', '산책하는', '여행하는', '책읽는',
      '함께하는', '수줍은', '해맑은', '즐거운', '행복한', '정다운', '사랑스러운', '멋진',
      '귀여운', '새로운', '맑은', '청명한', '단단한', '자유로운', '향기로운', '소중한', '솔직한', '반가운',
    ],
    nouns: [
      '수달', '여우', '단풍', '고래', '참새', '달빛', '구름', '토끼',
      '다람쥐', '고양이', '강아지', '판다', '코알라', '펭귄', '돌고래', '바다표범',
      '사슴', '비버', '알파카', '물개', '해달', '오리', '백조', '제비',
      '종달새', '부엉이', '올빼미', '반딧불이', '나비', '꿀벌', '무당벌레', '민들레',
      '해바라기', '라일락', '목련', '수국', '장미', '들꽃', '풀잎', '새싹',
      '솔방울', '도토리', '자작나무', '소나무', '숲길', '호수', '산들바람', '햇살', '별빛', '노을',
    ],
  },
  en: {
    adjectives: [
      'Calm', 'Kind', 'Mellow', 'Brave', 'Cozy', 'Bright', 'Jolly', 'Blue',
      'Sunny', 'Gentle', 'Happy', 'Cheerful', 'Playful', 'Clever', 'Curious', 'Friendly',
      'Peaceful', 'Dreamy', 'Hopeful', 'Merry', 'Lively', 'Quiet', 'Witty', 'Warm',
      'Serene', 'Daring', 'Graceful', 'Patient', 'Caring', 'Tender', 'Zesty', 'Sparkly',
      'Bouncy', 'Swift', 'Nimble', 'Lucky', 'Radiant', 'Breezy', 'Joyful', 'Humble',
      'Honest', 'Loyal', 'Bold', 'Fresh', 'Golden', 'Silver', 'Rosy', 'Misty', 'Fuzzy', 'Bubbly',
    ],
    nouns: [
      'Otter', 'Fox', 'Maple', 'Whale', 'Sparrow', 'Moon', 'Cloud', 'Rabbit',
      'Panda', 'Koala', 'Penguin', 'Dolphin', 'Seal', 'Deer', 'Alpaca', 'Squirrel',
      'Hedgehog', 'Badger', 'Robin', 'Swan', 'Wren', 'Finch', 'Lark', 'Owl',
      'Duck', 'Falcon', 'Puffin', 'Turtle', 'Gecko', 'Bunny', 'Butterfly', 'Firefly',
      'Dragonfly', 'Ladybug', 'Honeybee', 'Blossom', 'Daisy', 'Lily', 'Rose', 'Tulip',
      'Violet', 'Clover', 'Fern', 'Willow', 'Birch', 'Acorn', 'Pebble', 'Lake', 'Breeze', 'Meadow',
    ],
  },
} as const;

export function generateNickname(language: NicknameLanguage, random = Math.random) {
  const words = WORDS[language];
  return `${pick(words.adjectives, random)}${pick(words.nouns, random)}`;
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export type NicknameLanguage = 'ko' | 'en';

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

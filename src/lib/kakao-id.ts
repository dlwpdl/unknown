// 카톡 아이디 written in a post body: "카톡 abc123", "카톡 아이디는 abc123이에요", "카톡: abc123".
// Only a 카톡 word, an optional 아이디/ID and ":"/"는", then an ASCII id counts. Links (open.kakao.com, pf.kakao.com) never match
// because the word must not follow a letter, digit, dot, slash or hyphen and an id cannot start with a dot.
const KAKAO_ID = /(?<![A-Za-z0-9./@-])(?:카카오톡|카톡|kakao\s?talk|katalk|kakao)(?![A-Za-z가-힣])(?:\s*(?:아이디|id)(?![A-Za-z0-9]))?\s*(?:[:：]|는|은)?\s*([A-Za-z0-9](?:[A-Za-z0-9._-]{2,18}[A-Za-z0-9]))(?![A-Za-z0-9._-]*[/@])/gi;

export type KakaoPart = { text: string; kakaoId?: string };

// The body cut into plain runs and the ids inside it, in order; joined back, the text is unchanged.
export function splitKakaoIds(text: string): KakaoPart[] {
  const parts: KakaoPart[] = [];
  let from = 0;
  for (const match of text.matchAll(KAKAO_ID)) {
    const id = match[1], start = match.index + match[0].length - id.length;
    if (start > from) parts.push({ text: text.slice(from, start) });
    parts.push({ text: id, kakaoId: id });
    from = start + id.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

export const kakaoIds = (text: string) => [...new Set(splitKakaoIds(text).flatMap(part => part.kakaoId ? [part.kakaoId] : []))].slice(0, 2);

// Every word on the event apply page (/apply?event=…) and the business page (/partner#…), in one place for review.
// Apply page: keys and wording from the supervisor-reviewed galbi copy.json (output/reviews/influencer-event-automation-2026-11-02/
// galbi-example, 2026-11-02); its example values (galbi, dates, 2 people, 7 days, covered items) come from the campaign here.
// `done` is the approved follow notice word for word (title + ' ' + body). Keys marked "draft" are not in copy.json yet.
// `privacy` is the supervisor's corrected line (2026-11-02): entries stay in the creator list and winners' details reach the business.
export type EventLanguage = 'en' | 'ko';
export type EventLookupStatus = 'winner' | 'discount' | 'none';
export type SupportKey = 'meal' | 'drinks' | 'alcohol' | 'parking' | 'fee';

export const EVENT_COPY = {
  en: {
    languageName: 'English',
    // apply page (copy.json)
    host: (account: string) => `Hosted by @gling.app with ${account}`,
    h_cover: 'What we cover',
    cover: { meal: (party: number) => `Meal for ${party}`, drinks: () => 'Soft drinks', alcohol: () => 'Alcohol', parking: () => 'Parking', fee: () => 'Creator fee' } as Record<SupportKey, (party: number) => string>,
    yes: 'Covered',
    no: 'Not covered',
    h_do: 'What you do',
    do: (days: number) => `Within ${days} days of your visit, post one Reel tagging @gling.app and the restaurant`,
    h_apply: 'Apply',
    l_handle: 'Instagram handle',
    handle_ph: 'yourhandle',
    l_slots: 'When would you like to come?',
    first: '1st choice',
    second: '2nd choice (optional)',
    date_ph: 'Date',
    time_ph: 'Time',
    l_party: 'How many people, including you?',
    party_max: (max: number) => `Up to ${max}`,
    party_less: 'One fewer',
    party_more: 'One more',
    l_allergy: "Any allergies or foods you can't eat?",
    none: 'None',
    allergy_ph: 'e.g. shellfish, peanuts',
    l_reel: (max: number) => `How soon after your visit can you post the Reel? (${max} days max)`,
    reel: (days: number) => `Within ${days} day${days === 1 ? '' : 's'}`,
    l_lang: 'Language',
    privacy: "We use your details to run this event. If you're picked, the restaurant sees your visit time, party size and allergies. We keep your Instagram handle in our creator list.",
    btn_submit: 'Apply',
    done: ['Got your entry!', "We'll check on draw day that you're following @gling.app. If you're not, your entry won't count."],
    // draft: under `done`. Sending the form again changes nothing (security review 2026-11-03), so changes come by DM.
    doneChange: "Applying again won't update your entry. Need to change something? DM us at @gling.app.",
    btn_profile2: 'Open @gling.app',
    foot: 'Gling · gling.ej-entertainment.com',
    // draft: the "when" line built from campaign dates (copy.json's example adds weekdays and a winner date the campaign does not store)
    when: (first: string, last: string, closes: string | null) => [first === last ? `Visit on ${first}.` : `Visits ${first} to ${last}.`, closes ? `Applications close ${closes}.` : ''].filter(Boolean).join(' '),
    // draft: page states and form errors
    loading: 'Loading',
    expired: 'This link has expired.',
    loadFailed: "Couldn't load this page.",
    loadFailedBody: 'Check your connection and try again.',
    retry: 'Try again',
    badHandle: 'Check your Instagram handle.',
    needSlot: 'Pick a date and time for your 1st choice.',
    halfSlot: 'Pick both a date and a time for your 2nd choice, or neither.',
    sameSlot: 'Your 2nd choice is the same as your 1st.',
    needAllergy: 'Tap None or type your allergies.',
    needReel: 'Pick when you can post the Reel.',
    tooMany: 'Too many tries. Try again in an hour.',
    closed: 'This event is no longer taking entries.',
    sendFailed: "Couldn't send it. Try again.",
    // draft: business page
    partnerPrivate: 'Only people with this link can see this page.',
    winners: 'Winners and visit times',
    noWinners: 'No winners picked yet.',
    noVisit: 'Visit time not set yet',
    party: (count: number) => `Party of ${count}`,
    allergies: (text: string) => `Allergies: ${text}`,
    noAllergies: 'No allergies',
    applicants: (count: number) => `${count} applied so far`,
    discount: 'Event discount',
    discountDetail: (percent: number | null, day: string | null) => [percent ? `${percent}% off` : '', day ? `until ${day}` : ''].filter(Boolean).join(' · '),
    runsUntil: (day: string) => `Runs until ${day}`,
    check: 'Check a customer',
    // Each check that finds someone is one use; the same person within 3 hours is the same visit (owner 2026-11-02 "가게 링크 버튼으로 세기").
    checkHint: "Enter the Instagram handle the customer shows you when they pay, then tap Check. If they're on the list, it's logged as one use right away. Checking the same person again within 3 hours counts as the same visit.",
    checkButton: 'Check',
    useLogged: (count: number) => `Logged · ${count} ${count === 1 ? 'use' : 'uses'} so far`,
    useUndone: "Undone. This one won't count.",
    undo: 'Undo',
    undoFailed: "This can't be undone anymore. It's over a day old or was already undone.",
    mealUsed: 'This winner may have already had their prize meal. Check with them first.',
    result: { winner: (handle: string) => `@${handle} is a winner.`, discount: (handle: string) => `@${handle} gets the event discount.`, none: (handle: string) => `@${handle} isn't on this event's list.` } as Record<EventLookupStatus, (handle: string) => string>,
  },
  ko: {
    languageName: '한국어',
    host: (account: string) => `주최 @gling.app · ${account}`,
    h_cover: '지원 내용',
    cover: { meal: (party: number) => `식사 (${party}인)`, drinks: () => '음료', alcohol: () => '주류', parking: () => '주차', fee: () => '원고료' } as Record<SupportKey, (party: number) => string>,
    yes: '있음',
    no: '없음',
    h_do: '할 일',
    do: (days: number) => `다녀온 뒤 ${days}일 안에 @gling.app과 가게를 태그해서 릴스 1개 올리기`,
    h_apply: '지원하기',
    l_handle: '인스타 아이디',
    handle_ph: 'yourhandle',
    l_slots: '언제 오고 싶으세요?',
    first: '1순위',
    second: '2순위 (선택)',
    date_ph: '날짜',
    time_ph: '시간',
    l_party: '본인 포함 몇 명이 오세요?',
    party_max: (max: number) => `최대 ${max}명`,
    party_less: '한 명 줄이기',
    party_more: '한 명 늘리기',
    l_allergy: '알레르기나 못 먹는 음식이 있어요?',
    none: '없어요',
    allergy_ph: '예: 갑각류, 땅콩',
    l_reel: (max: number) => `다녀와서 며칠 안에 릴스를 올릴 수 있어요? (최대 ${max}일)`,
    reel: (days: number) => `${days}일 안`,
    l_lang: '언어',
    privacy: '적어 주신 정보는 이 이벤트를 진행하는 데 써요. 당첨되면 방문 시간, 인원, 알레르기를 가게에서 볼 수 있어요. 인스타 아이디는 글링 크리에이터 목록에 남아요.',
    btn_submit: '지원하기',
    done: ['신청받았어요!', '추첨하는 날 @gling.app 팔로우를 한 번 확인해요. 그날 팔로우가 안 되어 있으면 추첨에서 빠져요.'],
    doneChange: '다시 신청해도 처음 적어 주신 내용은 안 바뀌어요. 바꿀 게 있으면 @gling.app으로 DM 주세요.',
    btn_profile2: '@gling.app 열기',
    foot: '글링 · gling.ej-entertainment.com',
    // Korean dates here always end in 일, so 이에요 fits.
    when: (first: string, last: string, closes: string | null) => [first === last ? `방문은 ${first}이에요.` : `방문은 ${first}부터 ${last}까지예요.`, closes ? `신청은 ${closes}까지 받아요.` : ''].filter(Boolean).join(' '),
    loading: '불러오는 중',
    expired: '링크가 만료됐어요.',
    loadFailed: '페이지를 불러오지 못했어요.',
    loadFailedBody: '인터넷 연결을 확인한 뒤 다시 불러와 주세요.',
    retry: '다시 불러오기',
    badHandle: '인스타 아이디를 다시 확인해 주세요.',
    needSlot: '1순위 날짜와 시간을 골라 주세요.',
    halfSlot: '2순위는 날짜와 시간을 둘 다 고르거나 둘 다 비워 주세요.',
    sameSlot: '2순위가 1순위와 같아요.',
    needAllergy: "'없어요'를 누르거나 알레르기를 적어 주세요.",
    needReel: '릴스를 언제 올릴 수 있는지 골라 주세요.',
    tooMany: '신청을 너무 여러 번 했어요. 한 시간 뒤에 다시 해 주세요.',
    closed: '이 이벤트는 신청이 끝났어요.',
    sendFailed: '보내지 못했어요. 다시 눌러 주세요.',
    partnerPrivate: '이 링크가 있는 사람만 이 페이지를 볼 수 있어요.',
    winners: '당첨자와 방문 일정',
    noWinners: '아직 당첨자를 고르지 않았어요.',
    noVisit: '방문 일정 미정',
    party: (count: number) => `${count}명`,
    allergies: (text: string) => `알레르기: ${text}`,
    noAllergies: '알레르기 없음',
    applicants: (count: number) => `지금까지 ${count}명이 신청했어요`,
    discount: '이벤트 할인',
    discountDetail: (percent: number | null, day: string | null) => [percent ? `${percent}% 할인` : '', day ? `${day}까지` : ''].filter(Boolean).join(' · '),
    runsUntil: (day: string) => `${day}까지 진행해요`,
    check: '손님 확인',
    checkHint: '계산할 때 손님이 보여 주는 인스타 아이디를 넣고 확인하기를 눌러 주세요. 명단에 있는 분이면 누르는 순간 한 번 쓴 걸로 기록돼요. 같은 분을 3시간 안에 또 확인해도 같은 방문으로 쳐요.',
    checkButton: '확인하기',
    useLogged: (count: number) => `기록됐어요 · 지금까지 ${count}번 썼어요`,
    useUndone: '취소했어요. 이번 건은 빠져요.',
    undo: '취소',
    undoFailed: '이제 취소할 수 없어요. 하루가 지났거나 이미 취소된 기록이에요.',
    mealUsed: '당첨 식사를 이미 드신 분 같아요. 계산 전에 한 번 여쭤봐 주세요.',
    result: { winner: (handle: string) => `@${handle} 님은 당첨자예요.`, discount: (handle: string) => `@${handle} 님은 이벤트 할인 대상이에요.`, none: (handle: string) => `@${handle} 님은 이번 이벤트 명단에 없어요.` } as Record<EventLookupStatus, (handle: string) => string>,
  },
};

const utc = (value: string) => new Date(`${value}T00:00:00Z`);

/** A YYYY-MM-DD day as written (never shifted through the viewer's time zone): "Nov 23" / "11월 23일". */
export function eventDay(value: string, language: EventLanguage) {
  const date = utc(value);
  return language === 'ko' ? `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A visit date to pick: "Mon, Nov 23" / "11월 23일 (월)". */
export function eventDate(value: string, language: EventLanguage) {
  const date = utc(value);
  if (language === 'en') return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  return `${eventDay(value, 'ko')} (${'일월화수목금토'[date.getUTCDay()]})`;
}

/** An 'HH:MM' visit time: "5:30 pm" / "저녁 5시 30분". */
export function eventTime(value: string, language: EventLanguage) {
  const [hour, minute] = value.split(':').map(Number);
  const twelve = hour % 12 || 12;
  if (language === 'en') return `${twelve}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
  const part = hour < 6 ? '새벽' : hour < 12 ? '오전' : hour < 17 ? '낮' : hour < 21 ? '저녁' : '밤';
  return `${part} ${twelve}시${minute ? ` ${minute}분` : ''}`;
}

/** A confirmed visit time in the business's own time zone. */
export function eventVisit(value: string, timeZone: string, language: EventLanguage) {
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));
}

/** Reel day choices: 3, 5 and 7 up to the campaign's limit (owner 2026-11-02 "7일이 맥시멈"), or every day when the limit is under 3. */
export function reelChoices(max: number) {
  const usual = [3, 5, 7].filter(days => days <= max);
  return usual.length ? usual : Array.from({ length: Math.max(0, Math.min(max, 7)) }, (_, index) => index + 1);
}

/** Same rule as private.event_handle: checked here so a typo does not use up one of the ten hourly tries. */
export function eventHandle(value: string) {
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) && !/^\.|\.$|\.\./.test(handle) ? handle : null;
}

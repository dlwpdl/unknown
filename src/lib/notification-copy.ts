// English copy for server-written Korean notification bodies.
// Pure TS (no React, i18n or Supabase imports) so the app and the push edge function share it.
export type Translate = (text: string, ...values: unknown[]) => string;
const same: Translate = text => text;
const monthDay = (month: string, day: string, time?: [string, string]) => new Intl.DateTimeFormat('en-CA', time
  ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' })
  .format(new Date(2000, Number(month) - 1, Number(day), Number(time?.[0] ?? 0), Number(time?.[1] ?? 0)));
const clock = (hour: string, minute: string) => new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Number(hour), Number(minute)));
// Event kinds written by private.festival_notification_body.
const EVENT_KINDS: Record<string, string> = {
  '록 공연': 'a rock concert', '팝 공연': 'a pop concert', '재즈 공연': 'a jazz show', '힙합 공연': 'a hip-hop show', '전자음악 공연': 'an electronic music show',
  '클래식 공연': 'a classical concert', '컨트리 공연': 'a country concert', '메탈 공연': 'a metal show', '포크 공연': 'a folk show', '레게 공연': 'a reggae show', '음악 공연': 'a concert',
  '농구 경기': 'a basketball game', '아이스하키 경기': 'a hockey game', '야구 경기': 'a baseball game', '축구 경기': 'a soccer game', '미식축구 경기': 'a football game',
  '테니스 경기': 'a tennis match', '스포츠 경기': 'a sports game', '코미디 공연': 'a comedy show', '연극 공연': 'a play', '무용 공연': 'a dance performance', '공연': 'a show',
  '영화 상영 행사': 'a film screening', '할로윈 행사': 'a Halloween event', '영상 소개 행사': 'a video screening', '행사': 'an event',
};
type Pattern = [RegExp, (match: string[], translate: Translate) => string | null];
const eventPattern: Pattern = [/^(?:(\d{1,2})월 (\d{1,2})일, )?(?:(.+)에서 )?(?:(\d{1,2})월 (\d{1,2})일에 )?(.+?)[이가] (?:열려요|열릴 예정이에요)\.$/, (m, translate) => {
  const what = EVENT_KINDS[m[6]];
  if (!what) return null;
  const month = m[1] ?? m[4], day = m[2] ?? m[5];
  // The server falls back to the Korean city name when a venue is missing or too long.
  const place = m[3] && (translate(m[3]) !== m[3] ? ` in ${translate(m[3])}` : ` at ${m[3]}`);
  return `There’s ${what}${place ?? ''}${month ? ` on ${monthDay(month, day)}` : place ? '' : ' coming up'}.`;
}];
// shortcut: these mirror the final server copy (migrations); a server copy edit falls back to tr(body) until updated here.
const NOTIFICATION_PATTERNS: Record<string, Pattern[]> = {
  comment: [[/^(.+)님이 내 글에 댓글을 남겼어요\.$/, m => `${m[1]} commented on your post.`]],
  reply: [[/^(.+)님이 내 댓글에 답글을 남겼어요\.$/, m => `${m[1]} replied to your comment.`]],
  comment_like: [[/^(.+)님이 내 댓글에 공감했어요\.$/, m => `${m[1]} liked your comment.`]],
  post_like: [[/^(.+)님이 내 글에 공감했어요\.$/, m => `${m[1]} liked your post.`]],
  meetup_reminder: [
    [/^(.+) 모임이 24시간 뒤에 시작해요\. \((\d{2})\/(\d{2}) (\d{2}):(\d{2}) · 모임 장소 기준\)$/, m => `“${m[1]}” starts in 24 hours (${monthDay(m[2], m[3], [m[4], m[5]])}, local time).`],
    [/^(.+) 모임이 1시간 뒤에 시작해요\.$/, m => `“${m[1]}” starts in an hour.`],
  ],
  meetup_morning: [[/^(.+) 모임은 오늘 (\d{2}):(\d{2})에 시작해요\. \(모임 장소 기준\)$/, m => `“${m[1]}” starts today at ${clock(m[2], m[3])} local time.`]],
  // Meetup convenience (20261029110000): waitlist offers, auto-approvals and the empty-meetup tip.
  meetup_request: [
    [/^기다리던 모임에 자리가 났어요\. 지금 신청하면 호스트가 확인해요\.$/, () => 'A spot opened up in a meetup you’re waiting for. Apply now and the host will review it.'],
    [/^기다리던 모임에 자리가 났어요\. (\d+)시간 안에 신청하면 바로 함께할 수 있어요\.$/, m => `A spot opened up in a meetup you’re waiting for. Apply within ${m[1]} ${m[1] === '1' ? 'hour' : 'hours'} and you’re in.`],
    [/^대기하던 분이 시간 안에 신청해서 바로 승인됐어요\.$/, () => 'Someone from your waitlist applied in time and was approved.'],
    [/^자동 승인 조건에 맞는 신청이라 바로 승인됐어요\.$/, () => 'A request matched your auto-approval rules and was approved.'],
  ],
  meetup_host_tip: [
    [/^(.+) 모임에 아직 신청이 없어요\. 날짜를 바꾸거나 '처음 와도 돼요'를 켜 보세요\.$/, m => `No one has applied to “${m[1]}” yet. Try another date, or turn on “First-timers welcome”.`],
    [/^(.+) 모임에 아직 신청이 없어요\. 날짜를 바꿔 보는 건 어때요\?$/, m => `No one has applied to “${m[1]}” yet. How about another date?`],
  ],
  meetup_cancelled: [[/^(.+) 모임이 마감되거나 취소됐어요\. 모임 글에서 확인해 주세요\.$/, m => `“${m[1]}” was closed or cancelled. Check the meetup post for details.`]],
  meetup_changed: [
    [/^(.+) 모임의 시간이나 장소가 바뀌었어요\. 바뀐 내용을 확인해 주세요\.$/, m => `The time or place for “${m[1]}” changed. Check the updated details.`],
    // Host loyalty copy: 20261029130000_host_loyalty.sql. Encore before follower: the follower pattern would also match it.
    [/^또 열어 달라고 했던 (.+?)님이 새 모임을 열었어요\. ([\s\S]+)$/, m => `You asked ${m[1]} to host again, and they just did: ${m[2]}`],
    [/^(.+?)님이 새 모임을 열었어요\. ([\s\S]+)$/, m => `${m[1]} just opened a new meetup: ${m[2]}`],
    [/^「(.+?)」 공지: ([\s\S]+)$/, m => `Note from the host of “${m[1]}”: ${m[2]}`],
    [/^「(.+?)」 다음 모임 날짜가 잡혔어요\. (\d{2})\/(\d{2}) (\d{2}):(\d{2}) \(모임 현지 시간\)$/, m => `The next “${m[1]}” is set for ${monthDay(m[2], m[3])} at ${clock(m[4], m[5])} (local time).`],
    [/^「(.+?)」 체크인을 맡게 됐어요\./, m => `You’re on check-in for “${m[1]}”. When the meetup starts, check people in from the attendance screen.`],
  ],
  trending_post: [[/^오늘 (.+?) 소식, 같이 읽어볼까요\? (.+)$/, (m, translate) => `Today in ${translate(m[1])}: ${m[2]}`], eventPattern],
  city_places: [eventPattern],
  // First-week newcomer nudges (private.send_newcomer_nudges) reuse the trending_meetup kind.
  trending_meetup: [
    [/^가입 축하해요\. 처음 가기 편한 모임부터 모아 뒀어요\.$/, () => 'You’re in. We saved the easiest meetups to start with.'],
    [/^이번 주 모임이 올라왔어요\. (.+), 아직 자리 있어요\.$/, m => `This week’s meetups are up. “${m[1]}” still has room.`],
    [/^이번 주말엔 처음 오는 분 반기는 모임이 (?:(한|두|세|네) 곳|(\d+)곳) 있어요\.$/, m => {
      const count = m[1] ? '한두세네'.indexOf(m[1]) + 1 : Number(m[2]);
      return count === 1 ? 'One meetup this weekend welcomes first-timers.'
        : `${['', '', 'Two', 'Three', 'Four'][count] ?? count} meetups this weekend welcome first-timers.`;
    }],
    [/^벌써 일주일이네요\. 다음 주 모임도 열렸어요\.$/, () => 'One week in already. Next week’s meetups are open.'],
    [/^첫 모임 어땠어요\? 다음 주에도 같은 호스트 모임이 있어요\.$/, () => 'How was your first meetup? The same host has one next week too.'],
  ],
  trending_hashtag: [[/^(?:요즘 관심이 모이는 주제예요\.?|요즘 뜨는 해시태그 ·)\s*(#[\p{L}\p{M}\p{N}_-]{1,64})$/u, m => `Trending near you: ${m[1]}`]],
  like_summary: [
    [/^(.+)님 외 (\d+)명이 내 (글|댓글)을 좋아해요\.$/, m => `${m[1]} and ${m[2]} ${m[2] === '1' ? 'other' : 'others'} liked your ${m[3] === '글' ? 'post' : 'comment'}.`],
    [/^(.+)님이 내 (글|댓글)을 좋아해요\.$/, m => `${m[1]} liked your ${m[2] === '글' ? 'post' : 'comment'}.`],
  ],
  message_reaction: [[/^(.+)님이 내 메시지에 공감했어요\.$/, m => `${m[1]} loved your message.`]],
  // Push previews written by claim_push_notifications: "<sender>: <text>".
  message: [
    [/^(.+): 사진을 보냈어요\.$/, m => `${m[1]}: Sent a photo.`],
    [/^(.+): 위치를 보냈어요\.$/, m => `${m[1]}: Shared a location.`],
  ],
  admin_digest: [
    [/^새로 가입한 사람 (\d+)명, 운영 모임 참여 신청 (\d+)건이 있어요\.$/, m => `${m[1]} new ${m[1] === '1' ? 'member' : 'members'} and ${m[2]} ${m[2] === '1' ? 'request' : 'requests'} to join Gling-run meetups.`],
    [/^새로 가입한 사람이 (\d+)명 있어요\.$/, m => `${m[1]} new ${m[1] === '1' ? 'member' : 'members'} joined.`],
    [/^운영 모임 참여 신청이 (\d+)건 있어요\.$/, m => `${m[1]} new ${m[1] === '1' ? 'request' : 'requests'} to join Gling-run meetups.`],
  ],
  admin_meetup_request: [[/^(.+)님이 운영 모임 「(.+)」에 참여를 신청했어요\.$/, m => `${m[1]} asked to join the Gling-run meetup “${m[2]}”.`]],
  admin_signup: [[/^(.+?)님이 (.+)에 새로 가입했어요\.$/, (m, translate) => `${m[1]} just joined in ${translate(m[2])}.`]],
  admin_multiacct: [[/^같은 IP로 (\d+)개 계정이 접속했어요\. 관리자 화면에서 확인해 주세요\.$/, m => `${m[1]} accounts signed in from the same IP. Check the admin dashboard.`]],
  admin_security: [[/^최근 10분 동안 요청이 (\d+)건 들어왔어요\. 관리자 화면에서 확인해 주세요\.$/, m => `${m[1]} requests from one account in the last 10 minutes. Check the admin dashboard.`]],
};

// English inbox copy for server-written Korean bodies; stored rows (and routing above) keep the Korean text.
export function englishNotificationBody(item: { kind: string; body: string }, translate: Translate = same, actorName?: string) {
  if (item.kind === 'message_reaction' && actorName) return `${actorName} loved your message.`;
  for (const [pattern, render] of NOTIFICATION_PATTERNS[item.kind] ?? []) {
    const match = pattern.exec(item.body);
    const text = match && render(match, translate);
    if (text) return text;
  }
  return translate(item.body);
}

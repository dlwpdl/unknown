import type { MeetupInfoCell } from './meetup-info-cells.ts';

// Start templates for a new meetup: a title, an intro and three info cells per topic.
// category is set only where one of the app's categories clearly fits; otherwise the host keeps their own pick.
export type MeetupTopicCell = { label: string; hint: string; options?: readonly string[]; first?: boolean };
export type MeetupTopic = { id: string; label: string; title: string; intro: string; category: 'sports' | 'festival' | 'travel' | 'hobby' | null; cells: readonly MeetupTopicCell[] };

export const MEETUP_TOPICS: readonly MeetupTopic[] = [
  { id: 'sports', label: '운동', category: 'sports', title: '같이 운동할 분 찾아요',
    intro: '혼자 하면 자꾸 미루게 돼서 같이 할 분을 찾아요. 가장 느린 분 속도에 맞춰 천천히 해요. 비가 오면 전날 저녁에 알려 드릴게요.',
    cells: [{ label: '수준', hint: '', options: ['누구나', '처음', '꾸준히 하는 분'] }, { label: '준비물', hint: '운동화, 물 한 병' }, { label: '1인 비용', hint: '없어요' }] },
  { id: 'food', label: '밥 · 술 · 카페', category: null, title: '같이 밥 먹어요',
    intro: '혼자 가기 애매했던 가게가 있다면 같이 가요. 먹은 만큼 각자 계산하고, 자리는 제가 예약해 둘게요.',
    cells: [{ label: '가게', hint: '가고 싶은 가게 이름' }, { label: '1인 예상 비용', hint: '20달러쯤' }, { label: '확정은 언제까지', hint: '', options: ['하루 전', '당일 아침', '정하지 않아요'] }] },
  { id: 'show', label: '공연 · 축제 동행', category: 'festival', title: '공연 같이 가요',
    intro: '혼자 가기엔 아까운 공연이에요. 같이 갈 분이 있으면 좋겠어요. 끝나고 가볍게 차 한잔 해도 좋아요.',
    cells: [{ label: '행사', hint: '공연이나 축제 이름' }, { label: '티켓', hint: '', options: ['각자 사요', '같이 사요'] }, { label: '만나는 곳과 시간', hint: '공연장 앞, 시작 30분 전' }] },
  { id: 'trip', label: '여행 · 근교', category: 'travel', title: '근교로 당일치기 가요',
    intro: '당일치기로 다녀올 분들을 모아요. 가는 곳과 날짜는 신청한 분들과 맞춰 봐요.',
    cells: [{ label: '이동', hint: '', options: ['각자 가요', '카풀 자리 있어요'] }, { label: '1인 예상 비용', hint: '기름값 나눠서 25달러쯤' }, { label: '준비물', hint: '편한 신발, 간식' }] },
  { id: 'study', label: '스터디 · 언어교환', category: null, title: '언어교환 같이 해요',
    intro: '한국어도 영어도 말하면서 같이 늘려요. 한 시간은 한국어로, 한 시간은 영어로 이야기해요.',
    cells: [{ label: '언어와 수준', hint: '한국어·영어, 일상 대화 정도' }, { label: '준비물', hint: '요즘 있었던 일 하나' }, { label: '진행 방식', hint: '', options: ['자유롭게', '주제 정해서'] }] },
  { id: 'hobby', label: '취미', category: 'hobby', title: '같은 취미 하는 분 모여요',
    intro: '같은 취미 하는 분들이랑 편하게 만나고 싶어요. 처음 온 분도 되는지는 아래 정보에 적어 둘게요.',
    cells: [{ label: '처음이어도 되는지', hint: '', options: ['처음도 좋아요', '해 본 분만'] }, { label: '준비물', hint: '없어요' }, { label: '1인 비용', hint: '음료값 정도' }] },
  { id: 'new', label: '새로 온 사람', category: null, title: '새로 온 사람끼리 저녁 먹어요',
    intro: '얼마 전에 온 사람끼리 모여서 밥 먹어요. 처음 왔을 때 막막했던 얘기를 같이 나눠요.',
    cells: [{ label: '캐나다에 온 지', hint: '', options: ['3개월 안', '1년 안', '상관없어요'] }, { label: '지내는 동네', hint: '어디든 좋아요' }, { label: '쓰는 말', hint: '', options: ['한국어', '영어', '둘 다'] }] },
];

/** Fresh cells for a topic, stored in Korean whatever the app language: choice cells start on their first option, text cells stay empty (the hint is only a placeholder). */
export const topicCells = (topic: MeetupTopic): MeetupInfoCell[] =>
  topic.cells.map(cell => ({ label: cell.label, value: cell.options ? cell.options[0] : '' }));

/** True when both fields are empty or still hold what a template put there, so a template may replace them without asking. */
export const isUntouched = (current: string, filled: string) => !current.trim() || current === filled;

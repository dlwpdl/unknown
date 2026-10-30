import './business.css';

import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { BUSINESS_LIMITS } from '@/lib/membership';

// Owner-confirmed store prices (CA$); the server limits come from BUSINESS_LIMITS (mirrors private.business_membership_details_base).
const PLANS = [
  { tier: 'free', name: '무료', month: 0, year: null },
  { tier: 'plus', name: '플러스', month: 19.99, year: 199.99 },
  { tier: 'pro', name: '프로', month: 49.99, year: 499.99 },
  { tier: 'premium', name: '프리미엄', month: 149.99, year: 1399.99 },
] as const;
const money = (value: number) => `CA$${value.toLocaleString('en-CA', { minimumFractionDigits: value ? 2 : 0 })}`;
export const yearlyDiscount = (month: number, year: number) => Math.round((1 - year / (month * 12)) * 100);
const bumps = (tier: keyof typeof BUSINESS_LIMITS) => {
  const { bumps: limit, bumpCooldownHours: hours } = BUSINESS_LIMITS[tier];
  const every = hours === 24 ? '하루에 1번' : hours % 24 === 0 ? `${hours / 24}일에 1번` : `${hours}시간에 1번`;
  return limit == null ? every : `한 달 ${limit}번 · ${hours / 24}일 간격`;
};
const ROWS: [string, (plan: typeof PLANS[number]) => string][] = [
  ['월 요금', plan => money(plan.month)],
  ['연 요금', plan => plan.year ? `${money(plan.year)} (${yearlyDiscount(plan.month, plan.year)}% 할인)` : '—'],
  ['한 달 새 글', plan => `${BUSINESS_LIMITS[plan.tier].posts}편`],
  ['끌어올리기', plan => bumps(plan.tier)],
  ['공동 관리자', plan => BUSINESS_LIMITS[plan.tier].managers ? `${BUSINESS_LIMITS[plan.tier].managers}명까지 초대` : '없음'],
  ['AI 연결 (Claude·ChatGPT)', plan => plan.tier === 'free' ? '없음' : '쓸 수 있어요'],
  ['인증 후기 답글', () => '쓸 수 있어요'],
];
// Public businesses with a logo and an intro (checked 2026-10-30), so owners can see a finished profile.
const EXAMPLES = [
  { id: 'f97cd7ad-c80b-4f21-aaf5-b422e1bbab45', name: 'Jimoco Cafe & Pasta', meta: '음식점 · 밴쿠버' },
  { id: '5671d0cc-d6a9-51d1-90bb-62d930ef46f0', name: 'Aube Skin Club', meta: '뷰티·피부관리 · 밴쿠버' },
  { id: 'cced331d-59c4-433a-a68d-285a51f4db7a', name: 'Purple Penguin Cafe', meta: '카페 · 토론토' },
];
const FEATURES = [
  ['동네 한인에게 보여요', '올린 소식은 밴쿠버·토론토·몬트리올 한인들이 보는 피드와 비즈니스 찾기에 나와요.'],
  ['영수증으로 확인한 후기', '손님이 영수증으로 인증한 후기만 평점에 들어가요. 후기마다 사장님 답글을 달 수 있어요.'],
  ['웹에서 바로 올리기', '컴퓨터에서 가게 소식, 이벤트, 직원 구하는 글을 쓰고 끌어올릴 수 있어요.'],
  ['AI로 초안 쓰기', '유료 요금제에서는 Claude나 ChatGPT를 글링에 연결해 초안을 만들 수 있어요. 게시는 웹에서 직접 확인한 뒤에 해요.'],
] as const;
export const MANAGED_MAIL = `mailto:gling@ej-entertainment.com?subject=${encodeURIComponent('글링 관리 문의')}`;

export default function PublicBusiness() {
  const { play } = useInteractionFeedback();
  const tap = () => play('selection');
  return <div className="biz">
    <main className="biz-main">
      <p className="biz-kicker"><a href="/" onClick={tap}>글링</a> 비즈니스</p>
      <h1>한인 손님이 모이는 곳에 가게를 알려 보세요</h1>
      <p className="biz-lede">글링은 밴쿠버·토론토·몬트리올에 사는 한인들이 동네 이야기를 나누는 앱이에요. 가게 프로필을 만들어 두면 그 도시 한인들이 비즈니스를 찾을 때 함께 보여요.</p>
      <div className="biz-actions">
        <a className="biz-primary" href="/merchant/" onClick={tap}>무료로 시작하기</a>
        <a className="biz-secondary" href="#pricing" onClick={tap}>요금제 보기</a>
      </div>
      <p className="biz-note">등록과 기본 기능은 무료예요. 결제 정보 없이 시작할 수 있어요.</p>

      <section aria-labelledby="biz-features"><h2 id="biz-features">글링에서 할 수 있는 일</h2>
        <ul className="biz-features">{FEATURES.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}</ul>
      </section>

      <section aria-labelledby="biz-examples"><h2 id="biz-examples">먼저 시작한 가게들</h2>
        <ul className="biz-examples">{EXAMPLES.map(item => <li key={item.id}><a href={`/company/${item.id}`} onClick={tap}><strong>{item.name}</strong><span>{item.meta}</span></a></li>)}</ul>
      </section>

      <section aria-labelledby="biz-cities"><h2 id="biz-cities">도시별 현황</h2>
        <ul className="biz-cities">
          <li><strong>밴쿠버</strong> 비즈니스들이 소식과 채용 글을 올리고 있어요.</li>
          <li><strong>토론토</strong> 비즈니스들이 소식과 채용 글을 올리고 있어요.</li>
          <li><strong>몬트리올</strong> 아직 등록된 비즈니스가 없어요. 몬트리올 첫 비즈니스를 찾고 있어요.</li>
        </ul>
      </section>

      <section id="pricing" aria-labelledby="biz-pricing"><h2 id="biz-pricing">요금제</h2>
        <p>무료로 시작하고, 글을 더 자주 올리고 싶을 때 바꾸면 돼요.</p>
        <div className="biz-table" role="region" aria-labelledby="biz-pricing" tabIndex={0}>
          <table><caption className="biz-sr">비즈니스 요금제 비교</caption>
            <thead><tr><td />{PLANS.map(plan => <th scope="col" key={plan.tier}>{plan.name}</th>)}</tr></thead>
            <tbody>{ROWS.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{PLANS.map(plan => <td key={plan.tier}>{value(plan)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="biz-note">유료 요금제는 글링 앱의 멤버십 → 비즈니스에서 App Store나 Google Play 구독으로 결제해요. 실제 결제 금액은 스토어에 표시된 가격을 따라요. 공동 관리자 초대 링크는 유료 요금제에서 만들 수 있어요.</p>
      </section>

      <section className="biz-managed" aria-labelledby="biz-managed"><h2 id="biz-managed">글링 관리</h2>
        <p>한 달 글 15개를 글링이 대신 써서 올리고 관리해 드려요. 가격은 가게 상황을 듣고 따로 안내해요.</p>
        <a className="biz-secondary" href={MANAGED_MAIL} onClick={tap}>메일로 문의하기</a>
      </section>

      <p className="biz-footer"><a href="/merchant/" onClick={tap}>무료로 시작하기</a> · <a href="/faq" onClick={tap}>자주 묻는 질문</a> · <a href="/" onClick={tap}>글링 공개 게시판</a></p>
    </main>
  </div>;
}

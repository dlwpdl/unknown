import './event-report.css';
import { Asset } from 'expo-asset';
import Head from 'expo-router/head';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { ControlMetrics, MiniCard, Typography } from '@/constants/design-system';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { callEventLink } from '@/lib/event-links';
import { EVENT_COPY } from './event-copy';
import { EventLoadState } from './event-parts';

// The campaign_report JSON contract (output/reviews/creator-matching-bm-2026-11-02/build/PLAN.md), business version.
type Content = { label: string; kind: 'creator_content' | 'our_post'; reel: boolean; first_seen: string; views: number | null; views_at: string | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null; confirmed: boolean };
type StoreRow = { metric: string; value: number; period_start: string; period_end: string; source: string; confirmed: boolean; before_start: boolean };
type Report = {
  title: string; business: string; currency: string; starts_on: string | null; fix_on: string | null; fixed_at: string | null; synced_at: string;
  guests: { total: number; discount: number; winner: number; by_day: { day: string; n: number }[] };
  money: { guest_sales_cents?: number | null; discount_total_cents: number | null; hosted_meals_cents: number | null; store_spend_cents: number | null;
    per_guest_cents: number | null; confirmed: boolean };
  contents: Content[]; views_total: number; store: StoreRow[]; people: { reviewed: number; confirmed: number; visited: number; posted: number };
};

// Every word on the page. The approved panel's wording ('결과 리포트', output/reviews/creator-matching-bm-2026-11-02/creator-admin/index.html,
// owner "이거 좋다" 2026-11-03) unless marked "new"; the supervisor reviews the new ones.
const COPY = {
  page: '크리에이터 캠페인 결과',
  live: '실시간 동기화 · 마지막 ',
  fixed: '30일 숫자 확정 · ',
  fixOn: (day: string) => `30일째 확정 · ${day} 예정`,
  since: (day: string) => `${day}부터`,
  // new: what a set of links is, as the Instagram app names them
  kind: (reels: number, all: number) => reels === all ? '릴스' : reels ? '릴스·게시물' : '게시물',
  // the panel's '영상' when every link is a reel; new: the kind otherwise (a photo or carousel post is not a video)
  summary: (guests: string, perGuest: string, posts: number, views: string, kind: string) =>
    `온 손님 ${guests}명, 손님 1명당 ${perGuest} 들었어요. ${kind === '릴스' ? '영상' : kind} ${posts}개가 30일 동안 ${views}번 조회됐어요.`,
  ok: '확인값', settled: '확정', est: '추정',
  guestsQ: '몇 명 왔어요?', moneyQ: '얼마 벌었어요?', viewsQ: '몇 명이 봤어요?', whoQ: '누가 뭘 했어요?', leftQ: '뭐가 남았어요?',
  guests: '온 손님', people: (count: string) => `${count}명`, guestsHow: '가게 링크로 확인한 손님 수', guestsWait: '가게 링크가 켜지면 저절로 쌓여요',
  none: '아직 없음', storeLink: '가게 링크',
  sales: '그 손님 매출', salesHow: '할인 쓴 손님들이 낸 금액', pos: '포스',
  spend: '가게가 쓴 돈', noRecord: '기록 없음', meals: '식사 지원', discount: '할인액', spendSource: '가게 보고 · 포스',
  perGuest: '손님 1명당 든 돈', notYet: '계산 전', perGuestHow: (spend: string, guests: string) => `${spend} ÷ ${guests}명`,
  perGuestWait: '가게가 쓴 돈 ÷ 온 손님. 두 칸이 차면 저절로 계산돼요', auto: '자동 계산',
  views: '조회수 합계', viewsFixed: '30일째 값', // new: 조회수 합계 (a count of views, not of people)
  // new: '게시물' for a /p/ post as the Instagram app says (the panel only had a creator's reel), a number when one creator or we
  // posted more than once, and our own posts named '글링 게시물'/'글링 릴스' instead of the contract's '우리 글 1'
  creator: (letter: string, reel: boolean, number: number | null) => `크리에이터 ${letter} ${reel ? '릴스' : '게시물'}${number ? ` ${number}` : ''}`,
  ours: (reel: boolean, number: number | null) => `글링 ${reel ? '릴스' : '게시물'}${number ? ` ${number}` : ''}`,
  creatorAccount: '크리에이터 계정', ourAccount: '글링 계정',
  until: (day: string, views: string) => `${day}까지 ${views}`, fresh: '방금 반영',
  reactions: [['saves', '저장'], ['shares', '공유'], ['comments', '댓글'], ['likes', '좋아요']] as const, // the panel's order; new: 좋아요
  videos: '크리에이터 영상', posted: (confirmed: number, posted: number) => `확정 ${confirmed}명 중 게시 ${posted}명`, waiting: '올라오면 재요', noVideo: '없음',
  business: '비즈니스가 한 일', gling: '글링이 한 일', kinds: (count: number) => `${count}가지`,
  setDiscount: '할인 조건 정하기', checkGuests: '계산대에서 손님 확인', hostMeals: '당첨 팀 식사 대접',
  // new: '크리에이터' for the panel's '지원'; the count is everyone the board weighed, not only people who applied
  reviewed: (count: string) => `크리에이터 ${count}명 검토`, tracked: '크리에이터 게시 확인 · 조회 기록',
  ourPosts: (kind: string, count: number) => `글링 ${kind} ${count}개 올리기`, ourHandle: '@gling.app', // new: the panel's item was '당첨 발표 글 올리기'
  growth: '가게 팔로워·구글 리뷰', noBase: '비교 못 함', noBaseHow: '시작 전에 안 적어서 기준이 없어요.', check: '확인 전',
  growthHow: '시작 전 값과 30일째 값의 차이', growthLive: '시작 전 값과 지금 값의 차이', // new: growthLive, before day 30
  before: (value: string) => `시작 전 값 ${value}`,
  // new: names of what a business reports (private.partnership_metrics store rows)
  store: { google_searches: '구글 검색', google_directions: '구글 길찾기', google_calls: '구글 전화', ig_profile_visits: '인스타 프로필 방문',
    ig_follows: '인스타 새 팔로우', customers: '전체 손님 수', sales_cents: '전체 매출' } as Record<string, string>,
  legend: [['ok', '확인값', '실제로 센 숫자'], ['ok', '확정', '30일째 숫자, 더 바뀌지 않아요'], ['est', '추정', '다른 이유도 섞일 수 있는 숫자']] as const,
};

const lightWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;
const darkWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const FONT = 'system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif';
const font = (role: keyof typeof Typography) => {
  const type = Typography[role];
  return `${type.fontWeight} ${type.fontSize / 16}rem/${+(type.lineHeight / type.fontSize).toFixed(3)} ${FONT}`;
};
const track = (role: keyof typeof Typography) => `${+(Typography[role].letterSpacing / Typography[role].fontSize).toFixed(3)}em`;
const palette = (prefix: string, colors: Record<string, string>) => Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--${prefix}${key}`, value]));
// Colors.admin is the approved panel's light palette; event-report.css picks --l-* or --d-* by colour scheme, and print always takes --l-*.
// Sizes are rem so the browser's text size scales them.
const STYLE = {
  ...palette('l-', Colors.admin), ...palette('d-', Colors.dark),
  '--s1': `${Spacing.one}px`, '--s2': `${Spacing.two}px`, '--s3': `${Spacing.three}px`, '--s4': `${Spacing.four}px`, '--s5': `${Spacing.five}px`,
  '--r': `${MiniCard.radius}px`, '--r-l': `${ControlMetrics.radius.field}px`,
  '--f-title': font('sheetTitle'), '--ls-title': track('sheetTitle'), '--f-section': font('section'), '--ls-section': track('section'),
  '--f-body': font('body'), '--f-supporting': font('supporting'), '--f-label': font('label'), '--f-caption': font('caption'),
} as CSSProperties;

const count = (value: number) => value.toLocaleString('ko-KR');
const cash = (cents: number, currency: string) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'CAD',
  currencyDisplay: 'narrowSymbol', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
/** 'YYYY-MM-DD' as written, a timestamp in the viewer's time zone: 11/3. */
const md = (value: string) => {
  const [, month, day] = /^\d{4}-(\d{2})-(\d{2})$/.exec(value) ?? [];
  if (month) return `${+month}/${+day}`;
  const at = new Date(value);
  return `${at.getMonth() + 1}/${at.getDate()}`;
};
const hm = (value: string) => { const at = new Date(value); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`; };
const span = (row: StoreRow) => row.period_start === row.period_end ? md(row.period_start) : `${md(row.period_start)}–${md(row.period_end)}`;
const later = (a: StoreRow, b: StoreRow) => a.period_end > b.period_end || (a.period_end === b.period_end && a.period_start >= b.period_start);
const kindOf = (items: Content[]) => COPY.kind(items.filter(item => item.reel).length, items.length);
// The business gets no links (a link names the creator), so an item is known by its label and its place among that label's items.
const keys = (items: Content[]) => items.map((item, i) => `${item.label}·${items.slice(0, i).filter(other => other.label === item.label).length}`);
const signed = (value: number | null) => value === null ? '—' : `${value < 0 ? '−' : '+'}${count(Math.abs(value))}`;

function isReport(value: unknown): value is Report {
  const report = value as Report | null;
  return !!report && typeof report.title === 'string' && typeof report.synced_at === 'string' && !!report.guests && !!report.money && !!report.people
    && Array.isArray(report.guests.by_day) && Array.isArray(report.contents) && Array.isArray(report.store);
}

type Tone = 'ok' | 'est' | 'accent' | 'dash' | 'strong';
const Chip = ({ tone, children }: { tone?: Tone; children: ReactNode }) => <span className="rpt-chip" data-tone={tone}>{children}</span>;

function Question({ title, sure, children }: { title: string; sure: boolean; children: ReactNode }) {
  return <section className="rpt-q"><h2>{title} <Chip tone={sure ? 'ok' : 'est'}>{sure ? COPY.ok : COPY.est}</Chip></h2>{children}</section>;
}

function Kpi({ title, value, blank, how, source }: { title: string; value: string | null; blank?: string; how?: string; source?: string }) {
  return <div className={value === null ? 'rpt-kpi is-blank' : 'rpt-kpi'}>
    <p className="rpt-k">{title}</p>
    <p className="rpt-v">{value ?? blank}</p>
    {!!how && <p className="rpt-how">{how}</p>}
    {!!source && <Chip>{source}</Chip>}
  </div>;
}

function Done({ title, items, us }: { title: string; items: [string, string][]; us?: boolean }) {
  return <section className={us ? 'is-us' : undefined}>
    <h3>{title}<span>{COPY.kinds(items.length)}</span></h3>
    {items.length ? <ul>{items.map(([text, note]) => <li key={text}>{text}{!!note && <small> {note}</small>}</li>)}</ul>
      : <p className="rpt-none">{COPY.none}</p>}
  </section>;
}

function Sheet({ report, fresh }: { report: Report; fresh: ReadonlySet<string> }) {
  const { guests, money, contents, people, fixed_at: fixedAt } = report;
  const pay = (cents: number) => cash(cents, report.currency);
  const latest = (metric: string, before: boolean) => report.store.filter(row => row.metric === metric && row.before_start === before)
    .reduce<StoreRow | null>((pick, row) => !pick || later(row, pick) ? row : pick, null);
  const delta = (metric: string) => { const base = latest(metric, true), now = latest(metric, false); return base && now ? now.value - base.value : null; };

  const ours = contents.filter(item => item.kind === 'our_post'), itemKeys = keys(contents);
  // The contract gives each creator one letter for all their links and lists them in posting order, so number repeats in that order.
  const name = (item: Content) => {
    const same = item.kind === 'our_post' ? ours : contents.filter(other => other.kind === item.kind && other.label === item.label);
    const number = same.length > 1 ? same.indexOf(item) + 1 : null;
    return item.kind === 'creator_content' ? COPY.creator(item.label, item.reel, number) : COPY.ours(item.reel, number);
  };
  const waiting = !fixedAt && (!contents.length || people.confirmed > people.posted);
  // The panel's day-30 summary; before day 30 its sentence was written for one campaign, so the numbers below speak for themselves.
  const summary = fixedAt && guests.total > 0 && money.per_guest_cents !== null && contents.length > 0
    ? COPY.summary(count(guests.total), pay(money.per_guest_cents), contents.length, count(report.views_total), kindOf(contents)) : null;
  const sales = money.guest_sales_cents ?? null; // a server without the column yet sends nothing
  // A no-break space keeps each amount with its name when the three money cards share a row.
  const spendHow = [money.hosted_meals_cents !== null && `${COPY.meals}\u00A0${pay(money.hosted_meals_cents)}`,
    money.discount_total_cents !== null && `${COPY.discount}\u00A0${pay(money.discount_total_cents)}`].filter(Boolean).join(' + ');

  const firstDay = guests.by_day.map(row => row.day).sort()[0];
  const business = [
    (guests.discount > 0 || money.discount_total_cents !== null) && [COPY.setDiscount, ''],
    guests.total > 0 && [COPY.checkGuests, firstDay ? COPY.since(md(firstDay)) : ''],
    (guests.winner > 0 || money.hosted_meals_cents !== null) && [COPY.hostMeals, money.hosted_meals_cents !== null ? pay(money.hosted_meals_cents) : ''],
  ].filter((item): item is [string, string] => !!item);
  const gling = [
    people.reviewed > 0 && [COPY.reviewed(count(people.reviewed)), ''],
    ours.length > 0 && [COPY.ourPosts(kindOf(ours), ours.length), COPY.ourHandle],
    (contents.length > 0 || people.confirmed > 0) && [COPY.tracked, people.confirmed > 0 ? COPY.posted(people.confirmed, people.posted) : ''],
  ].filter((item): item is [string, string] => !!item);

  const based = latest('ig_followers', true) || latest('google_reviews', true);
  const followers = delta('ig_followers'), reviews = delta('google_reviews');
  const growth = !based ? [COPY.noBase, COPY.noBaseHow] : followers === null && reviews === null ? [COPY.check, fixedAt ? COPY.growthHow : COPY.growthLive]
    : [`${signed(followers)} · ${signed(reviews)}`, fixedAt ? COPY.growthHow : COPY.growthLive];
  const reported = Object.entries(COPY.store).flatMap(([metric, label]) => {
    const now = latest(metric, false), base = latest(metric, true), show = (value: number) => metric === 'sales_cents' ? pay(value) : count(value);
    return now || base ? [[label, now ? show(now.value) : COPY.check, [now && span(now), base && COPY.before(show(base.value))].filter(Boolean).join(' · ')]] : [];
  });

  return <article className="rpt-sheet" aria-labelledby="rpt-title">
    <div className="rpt-top">
      <span className="rpt-brand">
        <img className="rpt-wm-l" src={lightWordmark} alt="gling" width={720} height={300} />
        <img className="rpt-wm-d" src={darkWordmark} alt="gling" width={720} height={300} />
        <span className="rpt-kicker">{COPY.page}</span>
      </span>
      <span className="rpt-meta">
        {!fixedAt && !!report.fix_on && <Chip tone="dash">{COPY.fixOn(md(report.fix_on))}</Chip>}
        <span className={fixedAt ? 'rpt-sync is-fixed' : 'rpt-sync'}><i aria-hidden="true" />
          {fixedAt ? <>{COPY.fixed}<b>{md(fixedAt)}</b></> : <>{COPY.live}<b>{hm(report.synced_at)}</b></>}</span>
      </span>
    </div>
    <h1 id="rpt-title">{report.title}</h1>
    <p className="rpt-biz">{[report.business, report.starts_on && COPY.since(md(report.starts_on))].filter(Boolean).join(' · ')}</p>
    {!!summary && <p className="rpt-sum">{summary}</p>}

    <Question title={COPY.guestsQ} sure>
      <div className="rpt-kpis">
        <Kpi title={COPY.guests} value={guests.total > 0 || fixedAt ? COPY.people(count(guests.total)) : null} blank={COPY.none}
          how={guests.total > 0 || fixedAt ? COPY.guestsHow : COPY.guestsWait} source={COPY.storeLink} />
      </div>
    </Question>

    {/* With no money rows the contract says confirmed: false; the panel kept 확인값 over its empty cards */}
    <Question title={COPY.moneyQ} sure={money.confirmed || (sales === null && money.store_spend_cents === null)}>
      <div className="rpt-kpis">
        <Kpi title={COPY.sales} value={sales === null ? null : pay(sales)} blank={COPY.none} how={COPY.salesHow} source={COPY.pos} />
        <Kpi title={COPY.spend} value={money.store_spend_cents === null ? null : pay(money.store_spend_cents)} blank={COPY.noRecord}
          how={spendHow || `${COPY.meals} + ${COPY.discount}`} source={COPY.spendSource} />
        <Kpi title={COPY.perGuest} value={money.per_guest_cents === null ? null : pay(money.per_guest_cents)} blank={COPY.notYet}
          how={money.per_guest_cents !== null && money.store_spend_cents !== null ? COPY.perGuestHow(pay(money.store_spend_cents), count(guests.total)) : COPY.perGuestWait}
          source={COPY.auto} />
      </div>
    </Question>

    <Question title={COPY.viewsQ} sure={!contents.length || contents.some(item => item.confirmed)}>
      {contents.length > 0 && <div className="rpt-kpis"><Kpi title={COPY.views} value={count(report.views_total)} how={fixedAt ? COPY.viewsFixed : undefined} /></div>}
      <ul className="rpt-vlist">
        {contents.map((item, i) => {
          const reactions = COPY.reactions.flatMap(([key, label]) => { const value = item[key]; return value === null ? [] : [`${label} ${count(value)}`]; }).join(' · ');
          return <li key={itemKeys[i]}>
            <div><strong>{name(item)}</strong><small>{item.kind === 'creator_content' ? COPY.creatorAccount : COPY.ourAccount}</small></div>
            <div className="rpt-when">
              {item.views !== null && <Chip tone="strong">{item.views_at ? COPY.until(md(item.views_at), count(item.views)) : count(item.views)}</Chip>}
              {!!fixedAt && <Chip tone="ok">{COPY.settled}</Chip>}
              {!item.confirmed && <Chip tone="est">{COPY.est}</Chip>}
              {fresh.has(itemKeys[i]) && <Chip tone="accent">{COPY.fresh}</Chip>}
            </div>
            {!!reactions && <p className="rpt-extra">{reactions}</p>}
          </li>;
        })}
        {waiting && <li className="rpt-wait"><div><strong>{COPY.videos}</strong>{people.confirmed > 0 && <small>{COPY.posted(people.confirmed, people.posted)}</small>}</div>
          <div className="rpt-when"><Chip tone="dash">{COPY.waiting}</Chip></div></li>}
        {!!fixedAt && !contents.length && <li className="rpt-wait"><div><strong>{COPY.videos}</strong></div><div className="rpt-when"><Chip>{COPY.noVideo}</Chip></div></li>}
      </ul>
    </Question>

    <Question title={COPY.whoQ} sure>
      <div className="rpt-who"><Done title={COPY.business} items={business} /><Done title={COPY.gling} items={gling} us /></div>
    </Question>

    <Question title={COPY.leftQ} sure={false}>
      <div className="rpt-est">
        {[[COPY.growth, ...growth], ...reported].map(([label, value, how]) => <div key={label}><b>{label}</b><span className="rpt-val">{value}</span>{!!how && <p>{how}</p>}</div>)}
      </div>
    </Question>

    <p className="rpt-legend">{COPY.legend.map(([tone, chip, text]) => <span key={chip}><Chip tone={tone}>{chip}</Chip>{text}</span>)}</p>
  </article>;
}

function ReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [load, setLoad] = useState<'loading' | 'expired' | 'failed'>('loading');
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const last = useRef<Report | null>(null), readAt = useRef(0), reading = useRef(false);

  // gling.ej-entertainment.com/report#<token>: like /partner, the token stays in the fragment (no server log, Referer or analytics),
  // is read again for each call and is never stored or logged.
  const read = useCallback(async () => {
    const token = window.location.hash.slice(1);
    // Printing takes the token out of the address for a moment (below); until it is back, keep the numbers on screen.
    if (reading.current || (!token && last.current)) return;
    reading.current = true; readAt.current = Date.now();
    const { status, data } = await (token ? callEventLink<{ report: unknown }>({ report: token }) : Promise.resolve({ status: 404, data: null }));
    reading.current = false;
    const next = status === 200 ? data?.report : null;
    if (isReport(next)) {
      const before = last.current;
      const seen = before ? new Map(keys(before.contents).map((key, i) => [key, before.contents[i].views])) : null;
      setFresh(new Set(seen ? keys(next.contents).filter((key, i) => seen.get(key) !== next.contents[i].views) : []));
      last.current = next; setReport(next);
    } else if (status === 404 || status === 400) { last.current = null; setReport(null); setLoad('expired'); }
    else if (!last.current) setLoad('failed'); // a failed refresh keeps the last numbers, and the sync time says when they are from
  }, []);

  useEffect(() => { void read(); }, [read]);
  // A browser can print the page address in the PDF's header or footer: print without the token, then put it back.
  // The token waits in this local variable only while the print window is open.
  useEffect(() => {
    let hash = '';
    const address = () => window.location.pathname + window.location.search;
    const hide = () => { if (window.location.hash) { hash = window.location.hash; window.history.replaceState(window.history.state, '', address()); } };
    const show = () => { if (hash && !window.location.hash) window.history.replaceState(window.history.state, '', address() + hash); hash = ''; };
    window.addEventListener('beforeprint', hide);
    window.addEventListener('afterprint', show);
    return () => { window.removeEventListener('beforeprint', hide); window.removeEventListener('afterprint', show); show(); };
  }, []);
  const polling = !!report && !report.fixed_at;
  useEffect(() => {
    if (!polling) return;
    // While the page is on screen, read again every minute; coming back to it after a minute reads straight away.
    const tick = () => { if (document.visibilityState === 'visible' && Date.now() - readAt.current >= 60_000) void read(); };
    const timer = setInterval(tick, 5_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [polling, read]);

  return <div className="rpt" style={STYLE}>
    <Head><title>{`${report ? report.title : COPY.page} · 글링`}</title><meta name="robots" content="noindex, nofollow" /></Head>
    <main className="rpt-main">
      {report ? <Sheet report={report} fresh={fresh} />
        : <div className="rpt-state"><EventLoadState language="ko" state={load} onRetry={() => { setLoad('loading'); void read(); }} /></div>}
      <p className="rpt-foot">{EVENT_COPY.ko.foot}</p>
    </main>
  </div>;
}

/** The public web is dark everywhere else; the report follows the device's light or dark setting, so the shared loading
 * and error states (EventLoadState) follow it too. */
export default function EventReportPage() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return <ThemeOverrideProvider scheme={scheme}><ReportPage /></ThemeOverrideProvider>;
}

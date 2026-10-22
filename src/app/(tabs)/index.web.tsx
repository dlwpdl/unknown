import '../index.web.css';

import { Asset } from 'expo-asset';
import Head from 'expo-router/head';
import { useState, type CSSProperties } from 'react';

import { WebNightColors } from '@/constants/theme';
import {
  WEB_CATEGORY_LABELS,
  WEB_FEATURES,
  WEB_FOOTER_GROUPS,
  WEB_HERO_METRICS,
  WEB_POLICY_ITEMS,
  WEB_STORY_BLOCKS,
  getWebHomeCitySummary,
  listWebHomeCities,
  type WebHomeCitySummary,
} from '@/lib/web-home';

const appIconSrc = Asset.fromModule(require('@/assets/brand/gling-night-app-icon.png')).uri;
const wordmarkSrc = Asset.fromModule(require('@/assets/brand/gling-night-wordmark.png')).uri;
// Reuse the real B-design store captures so the website and store show the same app.
const vancouverScreenshotSrc = Asset.fromModule(require('../../../release/app-store/ios-6.9/01-vancouver.png')).uri;
const torontoScreenshotSrc = Asset.fromModule(require('../../../release/app-store/ios-6.9/02-toronto.png')).uri;
const citiesScreenshotSrc = Asset.fromModule(require('../../../release/app-store/ios-6.9/03-cities.png')).uri;
const siteColors = {
  '--bg': WebNightColors.background,
  '--surface': WebNightColors.backgroundElement,
  '--line': WebNightColors.line,
  '--text': WebNightColors.text,
  '--muted': WebNightColors.textSecondary,
  '--accent': WebNightColors.accent,
  '--accent-fill': WebNightColors.accentFill,
  '--accent-ink': WebNightColors.accentInk,
  '--navy': WebNightColors.navy,
} as CSSProperties;

function LaunchNotice({ city }: { city: WebHomeCitySummary }) {
  const subject = encodeURIComponent(`글링 ${city.name} 오픈 알림 신청`);
  const body = encodeURIComponent(`${city.name} 출시 소식을 받고 싶습니다.\n\n회신받을 이메일: `);

  return (
    <div className="site-waitlist-card">
      <span className="site-kicker">{city.launchNote}</span>
      <h3>{city.name}에서 만나요.</h3>
      <p>출시일과 설치 링크가 준비되면 소식을 전할게요.</p>
      <a className="site-primary-button" href={`mailto:eunsense0308@gmail.com?subject=${subject}&body=${body}`}>
        이메일로 오픈 알림 신청 <span aria-hidden="true">↗</span>
      </a>
      <p className="site-caption">메일 앱이 열려요. 신청 메일을 보내면 접수됩니다.</p>
    </div>
  );
}

export default function WebHome() {
  const cities = listWebHomeCities();
  const [cityId, setCityId] = useState(cities[0].id);
  const activeCity = getWebHomeCitySummary(cityId);
  const feedScreenshotSrc = activeCity.id === 'toronto' ? torontoScreenshotSrc : vancouverScreenshotSrc;

  return (
    <div className="site-page" style={siteColors} lang="ko">
      <Head>
        <title>글링 | 우리 동네의 오늘을 펼치다</title>
        <link rel="icon" type="image/png" href={appIconSrc} />
        <meta name="description" content="밴쿠버·토론토의 일상과 동네 정보를 한국어로 나누는 커뮤니티, 글링. 가까운 이웃의 이야기와 모임을 만날 준비를 하고 있어요." />
      </Head>
      <a className="site-skip-link" href="#main">본문으로 바로가기</a>
      <div className="site-shell">
        <header className="site-topbar">
          <a className="site-brand" href="#top" aria-label="글링 처음으로">
            <img src={wordmarkSrc} width="96" alt="gling" />
          </a>
          <nav className="site-nav" aria-label="사이트 섹션">
            <a href="#community">앱 둘러보기</a>
            <a href="#cities">시작하는 도시</a>
            <a href="#download" className="site-nav-cta">출시 소식 <span aria-hidden="true">↗</span></a>
          </nav>
        </header>

        <main id="main" tabIndex={-1}>
          <section className="site-hero" id="top" aria-labelledby="hero-title">
            <div className="site-hero-copy">
              <span className="site-kicker">캐나다의 오늘을, 한국어로.</span>
              <h1 id="hero-title">우리 동네의<br /><em>오늘을 펼치다.</em></h1>
              <p className="site-lead">낯선 도시가 조금 더 가까워지는 이야기.<br />작은 질문부터 취향이 닮은 모임까지,<br />글링에서 이웃의 하루를 만나세요.</p>
              <div className="site-city-switch" role="group" aria-label="미리 볼 도시 선택">
                {cities.filter((city) => city.state === 'open').map((city) => (
                  <button key={city.id} type="button" aria-pressed={city.id === activeCity.id}
                    aria-controls="city-preview" onClick={() => setCityId(city.id)}>
                    {city.name}
                  </button>
                ))}
              </div>
              <p className="site-city-line" aria-live="polite">{activeCity.headline}</p>
              <div className="site-button-row">
                <a className="site-primary-button" href="#download">오픈 알림 받기 <span aria-hidden="true">↗</span></a>
                <a className="site-text-link" href="#community">앱 둘러보기 <span aria-hidden="true">↓</span></a>
              </div>
              <p className="site-caption">iOS · Android 출시 준비 중</p>
            </div>
            <figure className="site-hero-preview" id="city-preview">
              <div className="site-stage">
                <img className="site-phone" src={feedScreenshotSrc} width="1320" height="2868"
                  alt={`글링 ${activeCity.name} 앱 화면. 우리 동네의 오늘, 카테고리, 예시 모임과 게시글.`} />
              </div>
              <figcaption className="site-caption">실제 앱 화면 · 게시글과 모임, 반응 수는 예시입니다.</figcaption>
            </figure>
          </section>

          <dl className="site-metric-row">
            {WEB_HERO_METRICS.map((metric) => (
              <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
            ))}
          </dl>

          <section className="site-section" id="community" aria-label="앱 둘러보기">
            {WEB_STORY_BLOCKS.map((block, index) => (
              <article key={block.id} className={`site-story-grid${index % 2 === 1 ? ' is-reversed' : ''}`}>
                <div className="site-story-copy">
                  <span className="site-kicker">{block.kicker}</span>
                  <h2>{block.title}</h2>
                  <p>{block.body}</p>
                  <ul className="site-story-points">
                    {block.points.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                  {block.image === 'feed' && (
                    <ul className="site-chip-cloud" aria-label="글링 카테고리">
                      {WEB_CATEGORY_LABELS.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </div>
                <figure className="site-story-preview">
                  <img className="site-phone" src={block.image === 'feed' ? torontoScreenshotSrc : citiesScreenshotSrc}
                    width="1320" height="2868" loading="lazy"
                    alt={block.image === 'feed' ? '글링 토론토의 예시 게시글과 모임' : '글링 앱의 도시 선택 화면'} />
                  <figcaption className="site-caption">
                    {block.image === 'feed' ? '실제 앱 화면 · 게시글과 모임, 반응 수는 예시입니다.' : '테스트 앱 화면 · 공개 출시는 준비 중입니다.'}
                  </figcaption>
                </figure>
              </article>
            ))}
          </section>

          <section className="site-section" id="cities" aria-labelledby="cities-title">
            <div className="site-section-head">
              <span className="site-kicker">먼저, 두 도시에서</span>
              <h2 id="cities-title">우리가 사는 곳에서<br />이야기는 시작되니까.</h2>
              <p>밴쿠버와 토론토부터 준비하고 있어요. 다음 도시의 출시 일정은 추후 안내할게요.</p>
            </div>
            <div className="site-city-grid">
              {cities.map((city) => (
                <article key={city.id} className={`site-city-card is-${city.state}`}>
                  <div className="site-city-card-head"><span>{city.province}</span><span>{city.stateLabel}</span></div>
                  <h3>{city.name}</h3>
                  <p>{city.blurb}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="site-section" id="about" aria-labelledby="about-title">
            <div className="site-section-head">
              <span className="site-kicker">우리가 지키는 것</span>
              <h2 id="about-title">생각은 자유롭게,<br />대화는 책임 있게.</h2>
              <p>정치적 입장, 소수 의견, 운영진 비판은 제재 이유가 아닙니다. 다른 사람의 안전과 참여를 직접 해치는 행위에는 분명한 기준을 둡니다.</p>
            </div>
            <div className="site-feature-grid">
              {WEB_FEATURES.map((feature) => (
                <article key={feature.title} className="site-feature-card">
                  <span className="site-kicker">{feature.kicker}</span>
                  <h3>{feature.title}</h3><p>{feature.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="site-section site-trust-section" id="trust" aria-labelledby="trust-title">
            <div className="site-section-head">
              <span className="site-kicker">함께 알고 시작해요</span>
              <h2 id="trust-title">신뢰는, 보이는 원칙에서.</h2>
              <p>데이터를 어떻게 사용하고, 대화를 어떻게 지키는지 안내합니다.</p>
            </div>
            <div className="site-policy-grid">
              {WEB_POLICY_ITEMS.map((item) => (
                <article key={item.id} id={`policy-${item.id}`} className="site-policy-card">
                  <h3>{item.title}</h3><p>{item.body}</p>
                </article>
              ))}
            </div>
            <a className="site-text-link" href="privacy">개인정보처리방침 읽기 <span aria-hidden="true">↗</span></a>
          </section>

          <section className="site-section" id="download" aria-labelledby="download-title">
            <div className="site-download-band">
              <div className="site-download-copy">
                <img className="site-download-icon" src={appIconSrc} width="64" height="64" loading="lazy" alt="글링 앱 아이콘" />
                <span className="site-kicker">곧, 우리 동네에서</span>
                <h2 id="download-title">첫 이야기를<br />함께 펼쳐요.</h2>
                <p>밴쿠버와 토론토에서 시작하는 글링.<br />가까운 이웃이 될 여러분을 기다립니다.</p>
                <div className="site-store-status" aria-label="스토어 출시 상태">
                  <span>App Store · 출시 준비 중</span><span>Google Play · 출시 준비 중</span>
                </div>
              </div>
              <LaunchNotice city={activeCity} />
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <div className="site-footer-brand">
            <img src={wordmarkSrc} width="92" loading="lazy" alt="gling" />
            <p>캐나다의 오늘을, 한국어로.<br />밴쿠버 · 토론토에서 시작하는 글링.</p>
            <a href="mailto:eunsense0308@gmail.com">운영팀에 문의하기 ↗</a>
          </div>
          <div className="site-footer-columns">
            {WEB_FOOTER_GROUPS.map((group) => (
              <div key={group.title}><strong>{group.title}</strong>
                {group.links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}
              </div>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

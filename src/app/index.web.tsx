import './index.web.css';

import { Asset } from 'expo-asset';
import { useState, type FormEvent } from 'react';

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const appIconSrc = Asset.fromModule(require('@/assets/brand/gling-app-icon.png')).uri;
const wordmarkSrc = Asset.fromModule(require('@/assets/brand/gling-wordmark.png')).uri;
const feedScreenshotSrc = Asset.fromModule(require('@/assets/marketing/landing/gling-feed-highres.png')).uri;
const flowScreenshotSrc = Asset.fromModule(require('@/assets/marketing/landing/community-flow-highres.png')).uri;
const trustScreenshotSrc = Asset.fromModule(require('@/assets/marketing/landing/trust-badges-highres.png')).uri;

function storeInterest(cityId: string, email: string, source: 'hero' | 'download') {
  try {
    const next = JSON.parse(window.localStorage.getItem('gl-web-interest') || '[]');
    next.push({ cityId, email, source, at: new Date().toISOString() });
    window.localStorage.setItem('gl-web-interest', JSON.stringify(next));
  } catch {
    // ponytail: demo capture only, local storage failure should not block the CTA.
  }
}

function StoreLink({ label }: { label: string }) {
  return (
    <a className="site-store-link" href="#download">
      <strong>{label}</strong>
      <span>오픈 알림 받기</span>
    </a>
  );
}

function WaitlistForm({
  city,
  inputId,
  source,
  status,
  onSubmit,
}: {
  city: WebHomeCitySummary;
  inputId: string;
  source: 'hero' | 'download';
  status: string;
  onSubmit: (event: FormEvent<HTMLFormElement>, source: 'hero' | 'download') => void;
}) {
  return (
    <section className="site-waitlist-card" aria-labelledby={`${inputId}-title`}>
      <div className="site-waitlist-head">
        <div>
          <span className="site-pill">{city.launchNote}</span>
          <h2 id={`${inputId}-title`}>{source === 'hero' ? '첫 기수 등록' : `${city.name} 오픈 알림`}</h2>
        </div>
        <strong>{city.name}</strong>
      </div>

      <p className="site-waitlist-copy">{city.headline}</p>

      <form onSubmit={(event) => onSubmit(event, source)}>
        <label htmlFor={inputId}>이메일 주소</label>
        <div className="site-form-row">
          <input
            id={inputId}
            type="email"
            name="email"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
          <button type="submit">대기열 등록</button>
        </div>
      </form>

      <div className="site-inline-list" aria-label="대기열 안내">
        <span>{city.postCount}개 시드 글 기준 구조 점검</span>
        <span>{city.meetupCount}개 모임 흐름 준비</span>
        <span>문의: gling@ej-entertainment.com</span>
      </div>

      <p className={`site-status${status ? '' : ' is-hidden'}`} role="status">
        {status}
      </p>
    </section>
  );
}

export default function WebHome() {
  const cities = listWebHomeCities();
  const [cityId, setCityId] = useState(cities[0].id);
  const [heroStatus, setHeroStatus] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const activeCity = getWebHomeCitySummary(cityId);

  const submitWaitlist = (event: FormEvent<HTMLFormElement>, source: 'hero' | 'download') => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const email = String(new FormData(form).get('email') || '').trim();
    if (!EMAIL_PATTERN.test(email)) return;

    storeInterest(activeCity.id, email, source);
    const message = `${activeCity.name} 오픈 알림 대기열에 등록했습니다. 스토어 링크가 준비되면 ${email}로 먼저 안내합니다.`;
    if (source === 'hero') {
      setHeroStatus(message);
    } else {
      setDownloadStatus(message);
    }
    form.reset();
  };

  return (
    <div className="site-page">
      <div className="site-shell">
        <header className="site-topbar">
          <a className="site-brand" href="#top">
            <img className="site-brand-icon" src={appIconSrc} alt="글링 앱 아이콘" />
            <img className="site-brand-wordmark" src={wordmarkSrc} alt="Gling" />
          </a>

          <nav className="site-nav" aria-label="사이트 섹션">
            <a href="#about">About</a>
            <a href="#community">Community</a>
            <a href="#cities">Cities</a>
            <a href="#trust">Trust</a>
            <a href="#download">Download</a>
          </nav>
        </header>

        <main>
          <section className="site-hero" id="top">
            <div className="site-hero-copy">
              <span className="site-kicker">North America Korean Community App</span>
              <h1>{`북미 한인 도시 커뮤니티를\n앱 안으로 다시 모읍니다.`}</h1>
              <p className="site-lead">
                글링은 밴쿠버와 토론토에서 먼저 열리는 커뮤니티 앱입니다. 생활 질문, 동네 정보, 댓글,
                DM, 모임 제안을 한 흐름으로 묶어 도시 단위 커뮤니티가 실제로 살아나게 만듭니다.
              </p>

              <div className="site-city-switch" role="tablist" aria-label="출시 도시 선택">
                {cities.filter((city) => city.state === 'open').map((city) => (
                  <button
                    key={city.id}
                    type="button"
                    role="tab"
                    aria-selected={city.id === activeCity.id}
                    className={city.id === activeCity.id ? 'is-active' : undefined}
                    onClick={() => setCityId(city.id)}>
                    {city.name}
                  </button>
                ))}
              </div>

              <div className="site-button-row">
                <a className="site-primary-button" href="#download">첫 기수 참여</a>
                <StoreLink label="App Store" />
                <StoreLink label="Google Play" />
              </div>

              <div className="site-metric-row">
                {WEB_HERO_METRICS.map((metric) => (
                  <article key={metric.label} className="site-metric-card">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </article>
                ))}
              </div>

              <article className="site-hero-city-card">
                <span>{activeCity.launchNote}</span>
                <strong>{activeCity.name}</strong>
                <p>{activeCity.blurb}</p>
                <div className="site-inline-list">
                  <span>{activeCity.postCount} posts</span>
                  <span>{activeCity.meetupCount} meetups</span>
                  <span>{activeCity.neighborhoodCount} neighborhoods</span>
                </div>
              </article>
            </div>

            <div className="site-hero-side">
              <div className="site-stage">
                <div className="site-stage-plane">
                  <figure className="site-stage-shot is-phone">
                    <img src={feedScreenshotSrc} alt="글링 피드 화면" />
                  </figure>
                  <article className="site-stage-note is-city">
                    <span>{activeCity.name}</span>
                    <strong>{activeCity.headline}</strong>
                  </article>
                  <article className="site-stage-dock" aria-label="커뮤니티 흐름">
                    <span>댓글 - DM - 모임</span>
                    <strong>도시 안에서 대화가 이어집니다.</strong>
                  </article>
                </div>
              </div>

              <WaitlistForm
                city={activeCity}
                inputId="hero-email"
                source="hero"
                status={heroStatus}
                onSubmit={submitWaitlist}
              />
            </div>
          </section>

          <section className="site-section" id="about">
            <div className="site-section-head">
              <span className="site-kicker">About Gling</span>
              <h2>{`무슨 앱인지\n첫 화면에서 바로\n이해되게 만듭니다.`}</h2>
              <p>
                Mobbin에서 반복해서 보이는 좋은 제품 사이트 패턴은 명확합니다. 첫 화면은 앱이 무엇인지
                바로 설명하고, 이후 섹션은 핵심 기능과 신뢰 요소를 한 덩어리씩 보여줍니다.
              </p>
            </div>

            <div className="site-feature-grid">
              {WEB_FEATURES.map((feature) => (
                <article key={feature.title} className="site-feature-card">
                  <span>{feature.kicker}</span>
                  <strong>{feature.title}</strong>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="site-section" id="community">
            {WEB_STORY_BLOCKS.map((block, index) => (
              <div
                key={block.id}
                className={`site-story-grid${index % 2 === 1 ? ' is-reversed' : ''}`}>
                <div className="site-story-copy">
                  <span className="site-kicker">{block.kicker}</span>
                  <h2>{block.title}</h2>
                  <p>{block.body}</p>
                  <ul className="site-story-points">
                    {block.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>

                <div className={`site-visual-panel is-${block.image}`}>
                  <figure className="site-visual-frame">
                    <img
                      src={block.image === 'feed' ? feedScreenshotSrc : flowScreenshotSrc}
                      alt={block.image === 'feed' ? '글링 피드 미리보기' : '글링 모임/대화 흐름 미리보기'}
                    />
                  </figure>
                  <div className="site-chip-cloud" aria-hidden="true">
                    {(block.image === 'feed' ? WEB_CATEGORY_LABELS : ['신고', '열람 기록', '이의 제기']).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="site-section" id="cities">
            <div className="site-section-head">
              <span className="site-kicker">Where We Open First</span>
              <h2>{`밴쿠버와 토론토에서 먼저 열고,\n다음 도시는 수요로 정합니다.`}</h2>
              <p>
                도시 밀도가 없는 커뮤니티는 첫날부터 비어 보입니다. 그래서 글링은 도시를 한꺼번에 열지
                않고, 서비스중 도시와 대기열 도시를 분리해서 운영합니다.
              </p>
            </div>

            <div className="site-city-grid">
              {cities.map((city) => (
                <article key={city.id} className={`site-city-card is-${city.state}`}>
                  <span>{city.stateLabel}</span>
                  <strong>{city.name}</strong>
                  <p>{city.blurb}</p>
                  <dl>
                    <div>
                      <dt>Posts</dt>
                      <dd>{city.postCount}</dd>
                    </div>
                    <div>
                      <dt>Meetups</dt>
                      <dd>{city.meetupCount}</dd>
                    </div>
                    <div>
                      <dt>Areas</dt>
                      <dd>{city.neighborhoodCount}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section className="site-section site-trust-section" id="trust">
            <div className="site-section-head">
              <span className="site-kicker">Trust And Policy</span>
              <h2>{`정책과 운영 원칙도\n메인에서 같이 공개합니다.`}</h2>
              <p>
                개인정보처리방침, 보존 기간, 관리자 열람, AI 분석, 이의 제기, 문의처는 서비스 소개와 같은
                레벨에서 보여줘야 합니다.
              </p>
            </div>

            <div className="site-trust-layout">
              <figure className="site-trust-shot">
                <img src={trustScreenshotSrc} alt="글링 trust 화면" />
              </figure>

              <div className="site-policy-grid">
                {WEB_POLICY_ITEMS.map((item) => (
                  <article key={item.id} id={`policy-${item.id}`} className="site-policy-card">
                    <span>{item.title}</span>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="site-section" id="download">
            <div className="site-download-band">
              <div className="site-download-copy">
                <span className="site-kicker">Download And First Cohort</span>
                <h2>{`스토어 오픈 전에는\n대기열이 가장 강한 CTA입니다.`}</h2>
                <p>
                  실제 App Store와 Google Play 링크는 출시 시점에 연결합니다. 지금은 첫 도시의 초기 밀도를
                  맞추기 위해 오픈 알림과 대기열 등록을 먼저 받습니다.
                </p>
                <div className="site-button-row">
                  <StoreLink label="App Store" />
                  <StoreLink label="Google Play" />
                </div>
              </div>

              <div className="site-download-brand">
                <img className="site-download-icon" src={appIconSrc} alt="글링 앱 아이콘" />
                <img className="site-download-wordmark" src={wordmarkSrc} alt="Gling" />
              </div>
            </div>

            <WaitlistForm
              city={activeCity}
              inputId="download-email"
              source="download"
              status={downloadStatus}
              onSubmit={submitWaitlist}
            />
          </section>
        </main>

        <footer className="site-footer">
          <div className="site-footer-brand">
            <img src={wordmarkSrc} alt="Gling" />
            <p>
              북미 한인 생활권을 위한 도시 커뮤니티 앱. 밴쿠버와 토론토에서 먼저 열리고, 다음 도시는 대기열
              밀도 기준으로 확장합니다.
            </p>
            <a href="mailto:gling@ej-entertainment.com">gling@ej-entertainment.com</a>
          </div>

          <div className="site-footer-columns">
            {WEB_FOOTER_GROUPS.map((group) => (
              <section key={group.title}>
                <strong>{group.title}</strong>
                {group.links.map((link) => (
                  <a key={link.label} href={link.href}>
                    {link.label}
                  </a>
                ))}
              </section>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

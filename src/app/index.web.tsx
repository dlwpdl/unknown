import './index.web.css';

import { Asset } from 'expo-asset';
import Head from 'expo-router/head';
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
          <h2 id={`${inputId}-title`}>{source === 'hero' ? '오픈 알림 받기' : `${city.name} 오픈 알림`}</h2>
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
          <button type="submit">오픈 알림 신청</button>
        </div>
      </form>

      <div className="site-inline-list" aria-label="대기열 안내">
        <span>{city.postCount}개의 이야기 준비</span>
        <span>{city.meetupCount}개의 모임 준비</span>
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
      <Head>
        <title>gling | 캐나다 한인 커뮤니티의 새로운 선택</title>
        <meta name="description" content="규칙으로 조용한 곳보다 대화로 살아 있는 곳. 다르게 생각해도 함께 이야기할 수 있는 캐나다 한인 커뮤니티 gling입니다." />
      </Head>
      <div className="site-shell">
        <header className="site-topbar">
          <a className="site-brand" href="#top">
            <img className="site-brand-icon" src={appIconSrc} alt="gling 앱 아이콘" />
            <img className="site-brand-wordmark" src={wordmarkSrc} alt="gling" />
          </a>

          <nav className="site-nav" aria-label="사이트 섹션">
            <a href="#about">About</a>
            <a href="#community">Community</a>
            <a href="#cities">Cities</a>
            <a href="#trust">Principles</a>
            <a href="#download">Download</a>
          </nav>
        </header>

        <main>
          <section className="site-hero" id="top">
            <div className="site-hero-copy">
              <span className="site-kicker">캐나다 한인 커뮤니티의 새로운 선택</span>
              <h1>{`규칙으로 조용한 곳보다,\n대화로 살아 있는 곳.`}</h1>
              <p className="site-lead">
                다르게 생각해도, 함께 이야기할 수 있도록. gling은 정치, 생활, 지역 정보와 일상에 대한
                다양한 의견을 열어두고 불법 콘텐츠와 사람을 향한 욕설·괴롭힘만 분명하게 제한합니다.
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
                    <img src={feedScreenshotSrc} alt="gling 피드 화면" />
                  </figure>
                  <article className="site-stage-note is-city">
                    <span>{activeCity.name}</span>
                    <strong>{activeCity.headline}</strong>
                  </article>
                  <article className="site-stage-dock" aria-label="커뮤니티 흐름">
                    <span>댓글 - DM - 모임</span>
                    <strong>다르게 생각해도 대화는 이어집니다.</strong>
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
              <span className="site-kicker">Why gling</span>
              <h2>{`같은 생각을 요구하지 않는\n커뮤니티가 필요합니다.`}</h2>
              <p>
                gling은 불편한 의견까지도 대화의 일부로 남겨둡니다. 운영은 관점을 판단하지 않고, 법을
                어기거나 다른 사람의 안전과 참여를 직접 해치는 행위에만 개입합니다.
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
                      alt={block.image === 'feed' ? 'gling 피드 미리보기' : 'gling 모임과 대화 흐름 미리보기'}
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
              <span className="site-kicker">Where gling Starts</span>
              <h2>{`밴쿠버와 토론토에서\n새로운 대화를 시작합니다.`}</h2>
              <p>
                첫날부터 사람과 이야기가 있는 피드를 만들기 위해 밴쿠버와 토론토부터 시작합니다. 다음
                도시는 기다리는 사람이 충분히 모인 곳부터 차례로 엽니다.
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
              <span className="site-kicker">Freedom With Clear Boundaries</span>
              <h2>{`생각은 자유롭게,\n대화는 책임 있게.`}</h2>
              <p>
                정치적 입장, 소수 의견, 운영진 비판은 제재 이유가 아닙니다. 불법 콘텐츠, 협박, 신상 공개,
                사기, 반복적인 욕설·괴롭힘처럼 다른 사람을 직접 해치는 행위만 제한합니다.
              </p>
            </div>

            <div className="site-trust-layout">
              <figure className="site-trust-shot">
                <img src={trustScreenshotSrc} alt="gling 운영 원칙 화면" />
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
                <span className="site-kicker">Join gling</span>
                <h2>{`다른 생각도 머물 수 있는\n첫 커뮤니티를 함께 만드세요.`}</h2>
                <p>
                  밴쿠버와 토론토에서 먼저 시작합니다. 지금 오픈 알림을 신청하면 스토어 링크와 첫 커뮤니티
                  소식을 가장 먼저 보내드립니다.
                </p>
                <div className="site-button-row">
                  <StoreLink label="App Store" />
                  <StoreLink label="Google Play" />
                </div>
              </div>

              <div className="site-download-brand">
                <img className="site-download-icon" src={appIconSrc} alt="gling 앱 아이콘" />
                <img className="site-download-wordmark" src={wordmarkSrc} alt="gling" />
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
            <img src={wordmarkSrc} alt="gling" />
            <p>
              규칙으로 조용한 곳보다 대화로 살아 있는 곳. 다르게 생각해도 함께 이야기할 수 있는 캐나다
              한인 커뮤니티입니다.
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

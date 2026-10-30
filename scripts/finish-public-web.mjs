import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../src/lib/mock.ts';
import { PUBLIC_SITE, PUBLIC_SOURCE, publicAboutGling, publicAboutGlingEn, publicPostUrl } from '../src/lib/public-seo.ts';
import { escapeHtml, prerenderPublicPosts } from './prerender-public-posts.mjs';

// Crawler copy for the home and city hubs; the reader removes #gling-static-home once the live feed renders.
function staticHub(cities, posts, city) {
  const link = 'color:#CBB9FF';
  const list = (city ? posts.filter(post => post.cityId === city.id) : posts).slice(0, 30);
  return `<section id="gling-static-home" lang="ko" style="max-width:720px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif">`
    + `<p style="margin:0">${escapeHtml(publicAboutGling)}</p>`
    + `<p style="margin:12px 0 0">${cities.map(item => `<a href="/${item.id}" style="${link}">${escapeHtml(item.name)} 한인 커뮤니티</a>`).join(' · ')} · <a href="/faq" style="${link}">자주 묻는 질문</a> · <a href="https://apps.apple.com/ca/app/id6809273242" style="${link}">iPhone 앱 받기</a></p>`
    + (list.length ? `<h2 style="margin:24px 0 8px;font-size:18px">${escapeHtml(city ? `${city.name} 한인 최근 이야기` : '최근 동네 이야기')}</h2><ul style="margin:0;padding-left:20px">${list.map(post => `<li><a href="/posts/${post.id}" style="${link}">${escapeHtml(post.title)}</a>${post.city || post.label ? ` <small>${escapeHtml([post.city, post.label].filter(Boolean).join(' · '))}</small>` : ''}</li>`).join('')}</ul>` : '')
    + '</section>';
}

export function finishPublicWeb(directory = 'dist', posts = []) {
  // GitHub Pages serves this for app-only paths and existing /post/:id links.
  copyFileSync(join(directory, '+not-found.html'), join(directory, '404.html'));
  const cities = CITIES.filter(city => city.state === 'open');
  // `/?city=` pages canonicalize to `/`, so only distinct pages are listed.
  const paths = ['/', ...cities.map(city => `/${city.id}`), '/meetups', '/visited', '/faq', '/terms', '/privacy', '/account-deletion', '/child-safety'];
  for (const [file, city] of [['index.html', null], ...cities.map(city => [`${city.id}.html`, city])]) {
    const target = join(directory, file);
    if (!existsSync(target)) continue;
    writeFileSync(target, readFileSync(target, 'utf8')
      .replace('</head>', `<link rel="alternate" type="application/rss+xml" title="글링 새 글" href="${PUBLIC_SITE}/rss.xml"/></head>`)
      .replace(/<body[^>]*>/, match => `${match}${staticHub(cities, posts, city)}`));
  }
  const day = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<lastmod>${new Date(time).toISOString().slice(0, 10)}</lastmod>` : ''; };
  writeFileSync(join(directory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${PUBLIC_SITE}${path}</loc></url>`).join('')}${posts.map(post => `<url><loc>${publicPostUrl(post.id)}</loc>${day(post.lastmod)}</url>`).join('')}</urlset>\n`);
  const protectedPaths = ['/merchant/', '/auth/', '/admin', '/chat', '/compose', '/profile', '/notifications', '/user/', '/meetup-create', '/meetup-join', '/meetup-application', '/meetup-profile'];
  writeFileSync(join(directory, 'robots.txt'), `User-agent: *\nAllow: /\n${protectedPaths.map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${PUBLIC_SITE}/sitemap.xml\n`);
  const recent = city => posts.filter(post => post.cityId === city.id).slice(0, 20)
    .map(post => `- [${String(post.title).replace(/[\\[\]\n\r]/g, ' ')}](${publicPostUrl(post.id)})${post.teaser ? `: ${String(post.teaser).replace(/[\n\r]/g, ' ')}` : ''}`).join('\n');
  const facts = [
    `- 열린 도시: ${cities.map(city => `${city.name}(${city.englishName})`).join(', ')}`,
    '- 할 수 있는 것: 동네 이야기, 맛집·가 볼 곳 지도, 렌트·구인·중고 거래, 축제·공연 동행, 소모임 만들기와 참여, 한국어↔영어 번역 보기',
    '- 요금: 무료, 일부 기능은 인앱 구매',
    '- 앱: iPhone은 App Store에서 받을 수 있고, Android는 비공개 테스트 중',
    `- 도시 페이지: ${cities.map(city => `[${city.name} 한인 커뮤니티](${PUBLIC_SITE}/${city.id})`).join(' · ')}`,
  ].join('\n');
  writeFileSync(join(directory, 'llms.txt'), `# 글링 Gling: 캐나다 한인 커뮤니티 (${cities.map(city => city.name).join('·')})\n\n> ${publicAboutGlingEn}\n\n${publicAboutGling}\n\n${facts}\n\n공개 미리보기는 작성자의 게시물 정보이며 글링의 공식 사실 확인이나 비즈니스 소유 인증을 뜻하지 않습니다. 게스트는 허용된 대표 이미지 한 장과 짧은 소개를 볼 수 있습니다. 로그인하거나 정상 가입을 마치면 현재 공개 상태와 열람 권한을 확인한 뒤 공개 글의 전체 본문을 웹에서 읽을 수 있습니다. 댓글 작성·대화·모임 참여는 앱에서 이용합니다. 아래 원문은 현재 공개 상태를 조회합니다. 삭제·비공개 글의 내용, 개인 대화와 계정 정보는 제공하지 않습니다. 공개 미리보기를 전체 원문으로 간주하지 마세요.\n\n## 공개 이야기\n\n- [글링 공개 게시판](${PUBLIC_SITE}/)\n${cities.map(city => `- [${city.name} 공개 미리보기 · 다음 페이지](${PUBLIC_SOURCE}?format=markdown&city=${city.id})`).join('\n')}\n${cities.map(city => recent(city) && `\n## ${city.name} 최근 글\n\n${recent(city)}\n`).filter(Boolean).join('')}\n## 이용 안내\n\n- [자주 묻는 질문](${PUBLIC_SITE}/faq)\n- [iPhone 앱](https://apps.apple.com/ca/app/id6809273242)\n- [이용약관](${PUBLIC_SITE}/terms)\n- [개인정보처리방침](${PUBLIC_SITE}/privacy)\n- [계정 삭제](${PUBLIC_SITE}/account-deletion)\n`);
  // Naver Search Advisor and other feed readers pick up new public posts from this (teasers only, same as the post pages).
  const date = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<pubDate>${new Date(time).toUTCString()}</pubDate>` : ''; };
  const item = ({ title, link, description, lastmod }) => `<item><title>${escapeHtml(title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><description>${escapeHtml(description)}</description>${date(lastmod)}</item>`;
  writeFileSync(join(directory, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>글링 | 캐나다 한인 커뮤니티</title><link>${PUBLIC_SITE}/</link><description>${escapeHtml(publicAboutGling)}</description><language>ko</language>${[
    ...cities.map(city => ({ title: `${city.name} 한인 커뮤니티 · 동네 이야기와 모임`, link: `${PUBLIC_SITE}/${city.id}`, description: `${city.name}에 사는 한인들이 나누는 동네 이야기, 맛집, 렌트·구인·중고, 소모임을 글링에서 둘러보세요.`, lastmod: posts.find(post => post.cityId === city.id)?.lastmod })),
    ...posts.slice(0, 100).map(post => ({ title: post.title, link: publicPostUrl(post.id), description: post.teaser || [post.city, post.label].filter(Boolean).join(' · '), lastmod: post.lastmod })),
  ].map(item).join('')}</channel></rss>\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'dist';
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Only the Pages deploy prerenders (CI exports against a stub project); there a failed fetch fails the deploy and keeps the previous site live.
  const prerender = process.env.GLING_PRERENDER_POSTS === '1';
  if (prerender && (!url || !key)) throw new Error('Supabase public env is required to prerender public posts');
  const posts = prerender ? await prerenderPublicPosts(directory, { url: url.replace(/\/+$/, ''), key, cities: CITIES.filter(city => city.state === 'open').map(city => city.id), searchToken: process.env.GLING_SEARCH_BUILD_TOKEN }) : [];
  finishPublicWeb(directory, posts);
  console.log(`Prerendered ${posts.length} public posts.`);
}

import { copyFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../src/lib/mock.ts';
import { PUBLIC_SITE, PUBLIC_SOURCE, publicPostUrl, publicSiteName } from '../src/lib/public-seo.ts';
import { prerenderPublicPosts } from './prerender-public-posts.mjs';

export function finishPublicWeb(directory = 'dist', posts = []) {
  // GitHub Pages serves this for app-only paths and existing /post/:id links.
  copyFileSync(join(directory, '+not-found.html'), join(directory, '404.html'));
  const cities = CITIES.filter(city => city.state === 'open');
  // `/?city=` pages canonicalize to `/`, so only distinct pages are listed.
  const paths = ['/', '/meetups', '/visited', '/terms', '/privacy', '/account-deletion', '/child-safety'];
  const day = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<lastmod>${new Date(time).toISOString().slice(0, 10)}</lastmod>` : ''; };
  writeFileSync(join(directory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${PUBLIC_SITE}${path}</loc></url>`).join('')}${posts.map(post => `<url><loc>${publicPostUrl(post.id)}</loc>${day(post.lastmod)}</url>`).join('')}</urlset>\n`);
  const protectedPaths = ['/merchant/', '/auth/', '/admin', '/chat', '/compose', '/profile', '/notifications', '/user/', '/meetup-create', '/meetup-join', '/meetup-application', '/meetup-profile'];
  writeFileSync(join(directory, 'robots.txt'), `User-agent: *\nAllow: /\n${protectedPaths.map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${PUBLIC_SITE}/sitemap.xml\n`);
  const recent = city => posts.filter(post => post.cityId === city.id).slice(0, 40)
    .map(post => `- [${String(post.title).replace(/[\\[\]\n\r]/g, ' ')}](${publicPostUrl(post.id)})${post.teaser ? `: ${String(post.teaser).replace(/[\n\r]/g, ' ')}` : ''}`).join('\n');
  writeFileSync(join(directory, 'llms.txt'), `# ${publicSiteName('ko')}\n\n> ${publicSiteName('en')}\n\n캐나다에서 동네 이야기와 모임, 맛집·비즈니스 정보를 나누는 커뮤니티입니다.\n\n공개 미리보기는 작성자의 게시물 정보이며 글링의 공식 사실 확인이나 비즈니스 소유 인증을 뜻하지 않습니다. 게스트는 허용된 대표 이미지 한 장과 짧은 소개를 볼 수 있습니다. 로그인하거나 정상 가입을 마치면 현재 공개 상태와 열람 권한을 확인한 뒤 공개 글의 전체 본문을 웹에서 읽을 수 있습니다. 댓글 작성·대화·모임 참여는 앱에서 이용합니다. 아래 원문은 현재 공개 상태를 조회합니다. 삭제·비공개 글의 내용, 개인 대화와 계정 정보는 제공하지 않습니다. 공개 미리보기를 전체 원문으로 간주하지 마세요.\n\n## 공개 이야기\n\n- [글링 공개 게시판](${PUBLIC_SITE}/)\n${cities.map(city => `- [${city.name} 공개 미리보기 · 다음 페이지](${PUBLIC_SOURCE}?format=markdown&city=${city.id})`).join('\n')}\n${cities.map(city => recent(city) && `\n## ${city.name} 최근 글\n\n${recent(city)}\n`).filter(Boolean).join('')}\n## 이용 안내\n\n- [이용약관](${PUBLIC_SITE}/terms)\n- [개인정보처리방침](${PUBLIC_SITE}/privacy)\n- [계정 삭제](${PUBLIC_SITE}/account-deletion)\n- [iPhone 앱](https://apps.apple.com/ca/app/id6809273242)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'dist';
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Only the Pages deploy prerenders (CI exports against a stub project); there a failed fetch fails the deploy and keeps the previous site live.
  const prerender = process.env.GLING_PRERENDER_POSTS === '1';
  if (prerender && (!url || !key)) throw new Error('Supabase public env is required to prerender public posts');
  const posts = prerender ? await prerenderPublicPosts(directory, { url: url.replace(/\/+$/, ''), key, cities: CITIES.filter(city => city.state === 'open').map(city => city.id) }) : [];
  finishPublicWeb(directory, posts);
  console.log(`Prerendered ${posts.length} public posts.`);
}

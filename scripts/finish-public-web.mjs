import { copyFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../src/lib/mock.ts';
import { PUBLIC_SITE, PUBLIC_SOURCE } from '../src/lib/public-seo.ts';

export function finishPublicWeb(directory = 'dist') {
  // GitHub Pages serves this for app-only paths and existing /post/:id links.
  copyFileSync(join(directory, '+not-found.html'), join(directory, '404.html'));
  const cities = CITIES.filter(city => city.state === 'open');
  const paths = ['/', '/terms', '/privacy', '/account-deletion', '/child-safety', ...cities.map(city => `/?city=${city.id}`)];
  writeFileSync(join(directory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${PUBLIC_SITE}${path}</loc></url>`).join('')}</urlset>\n`);
  const protectedPaths = ['/merchant/', '/auth/', '/admin', '/chat', '/compose', '/profile', '/notifications', '/user/', '/meetup-create', '/meetup-join', '/meetup-application', '/meetup-profile'];
  // Google permits a cross-host sitemap when the site's own robots.txt references it.
  writeFileSync(join(directory, 'robots.txt'), `User-agent: *\nAllow: /\n${protectedPaths.map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${PUBLIC_SITE}/sitemap.xml\n${cities.map(city => `Sitemap: ${PUBLIC_SOURCE}?format=sitemap&city=${city.id}`).join('\n')}\n`);
  writeFileSync(join(directory, 'llms.txt'), `# 글링 (gling)\n\n> 캐나다 한인 커뮤니티. 동네 이야기, 맛집, 비즈니스와 모임을 한국어로 나눕니다.\n\n공개 글은 작성자의 게시물이며 글링의 공식 사실 확인이나 업체 소유 인증을 뜻하지 않습니다. 아래 원문은 현재 공개 상태를 조회합니다. 삭제·비공개 글, 개인 대화와 계정 정보는 제공하지 않습니다. 원문의 출처 URL과 실제 작성자·발행일을 함께 확인해 주세요.\n\n## 공개 이야기\n\n- [글링 공개 게시판](${PUBLIC_SITE}/)\n${cities.map(city => `- [${city.name} 공개 글 · 최신 원문과 다음 페이지](${PUBLIC_SOURCE}?format=markdown&city=${city.id})`).join('\n')}\n\n## 이용 안내\n\n- [이용약관](${PUBLIC_SITE}/terms)\n- [개인정보처리방침](${PUBLIC_SITE}/privacy)\n- [계정 삭제](${PUBLIC_SITE}/account-deletion)\n- [iPhone 앱](https://apps.apple.com/ca/app/id6809273242)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) finishPublicWeb(process.argv[2]);

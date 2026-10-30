import { publicMetadata, publicReaderDescription } from '@/components/public-web/metadata';
import { PUBLIC_SITE, publicSiteName } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata(`${publicSiteName()} · 밴쿠버·토론토·몬트리올`, publicReaderDescription, `${PUBLIC_SITE}/`);
}

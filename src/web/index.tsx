import { publicMetadata, publicReaderDescription } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata('글링 | 캐나다 한인 커뮤니티', publicReaderDescription, `${PUBLIC_SITE}/`);
}

import { publicMetadata, publicReaderDescription } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata('글링 비즈니스 프로필', publicReaderDescription, `${PUBLIC_SITE}/company`);
}

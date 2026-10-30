import { publicMetadata, publicReaderDescription } from '@/components/public-web/metadata';
import { PUBLIC_SITE, publicSiteName } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata(`모임 | ${publicSiteName()}`, publicReaderDescription, `${PUBLIC_SITE}/meetups`, 'meetup');
}

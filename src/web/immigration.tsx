import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE, publicImmigrationMeta } from '@/lib/public-seo';

export { default } from '@/components/public-web/immigration';

export function generateMetadata() {
  return publicMetadata(publicImmigrationMeta.title, publicImmigrationMeta.description, `${PUBLIC_SITE}/immigration`);
}

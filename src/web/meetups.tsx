import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE, publicMeetupsMeta } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata(publicMeetupsMeta.title, publicMeetupsMeta.description, `${PUBLIC_SITE}/meetups`, 'meetup');
}

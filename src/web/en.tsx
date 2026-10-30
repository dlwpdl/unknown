import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/english';

export function generateMetadata() {
  return publicMetadata('Gling – Korean community app in Vancouver, Toronto and Montreal',
    'Gling (글링) is a free community app for Koreans in Vancouver, Toronto and Montreal: local stories, rentals, jobs, used goods and meetups, with Korean–English translation.',
    `${PUBLIC_SITE}/en`);
}

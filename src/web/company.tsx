import type { Metadata } from 'expo-router/server';

export { default } from '@/components/public-web/reader';

// Each public business is prerendered at /company/<id>; this id-less shell only serves old `/company?id=` links.
export function generateMetadata(): Metadata {
  return { title: '글링 비즈니스 프로필', robots: 'noindex, follow' };
}

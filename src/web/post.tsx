import type { Metadata } from 'expo-router/server';

export { default } from '@/app/post/[id]';

export function generateMetadata(): Metadata {
  const title = '글링 공유 | 글링';
  const description = 'Google·소셜 로그인 후 전체 내용과 모임을 확인해요.';
  return {
    title, description, robots: 'noindex, follow',
    openGraph: { siteName: '글링', title: '글링 공유', description },
  };
}

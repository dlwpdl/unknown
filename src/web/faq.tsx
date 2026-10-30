import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/faq';

export function generateMetadata() {
  return publicMetadata('글링 자주 묻는 질문 | 캐나다 한인 커뮤니티',
    '캐나다 한인 모임 커뮤니티 글링에 대해 자주 묻는 질문을 모았어요. 가입 없이 볼 수 있는지, 어떤 도시에서 쓸 수 있는지, 모임 참여 방법과 요금까지 확인하세요.',
    `${PUBLIC_SITE}/faq`);
}

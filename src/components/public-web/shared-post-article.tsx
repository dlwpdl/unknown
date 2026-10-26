import { useState } from 'react';
import { instagramPostLink, splitPostAttachments, splitPostLinks } from '../../../supabase/functions/_shared/post-links';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { useLanguage } from '@/hooks/use-language';
import { chillingSchedule } from '@/lib/chilling';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { postMapBody } from '@/lib/post-maps';
import { localizeBusinessDisclosure } from '@/lib/translation-source';
import type { Post } from '@/lib/types';

export function PublicPostBody({ body }: { body: string }) {
  const { play } = useInteractionFeedback(), { language, tr } = useLanguage();
  const attached = splitPostAttachments(body);
  return <><p className="reader-body">{splitPostLinks(localizeBusinessDisclosure(attached.body, tr)).map((part, index) => part.url
    ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={event => {
        play('selection');
        if (!instagramPostLink(part.url!) && !window.confirm(`${part.url}\n\n${language === 'ko' ? '악성 여부를 아직 확인하지 못한 외부 링크예요. 이동할까요?' : 'This external link hasn’t been checked for safety yet. Open it anyway?'}`)) event.preventDefault();
      }}>{part.text}</a>
    : part.text)}</p>{attached.urls.map((url, index) => <PostAttachmentLink key={`${url}-${index}`} url={url} />)}</>;
}

export function SharedPostArticle({ post }: { post: Post }) {
  const { language, tr } = useLanguage(), ko = language === 'ko';
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = post.imageUris?.[0];
  return <article className="shared-full reader-post">
    <p className="shared-kicker">{tr(CITIES.find(city => city.id === post.cityId)?.name ?? '')} · {tr(post.tag.label)}</p>
    <h1>{post.title}</h1>
    <p className="reader-meta">{post.business?.name ?? post.author.nickname} · {post.createdAtLabel}</p>
    {image && image !== failedImage && <img className="shared-cover" src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />}
    {post.room ? <section className="shared-meetup"><h2>{ko ? '모임 일정' : 'Meetup schedule'}</h2>
      <p>{chillingSchedule(post.room, ko ? 'ko-KR' : 'en-CA')}</p>
      <p>{post.room.closed ? ko ? '모집이 마감된 모임이에요.' : 'This meetup is closed.' : ko ? '자세한 모임 안내와 참여는 앱에서 확인해 주세요.' : 'See meetup details and join in the app.'}</p>
    </section> : <PublicPostBody body={postMapBody(post.body).body} />}
  </article>;
}

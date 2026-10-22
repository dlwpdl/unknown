import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { getPostImageSource, loadPublicPost } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { buildSharedPostUrl } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { MerchantPost } from '@/lib/admin-merchants';
import type { Post } from '@/lib/types';

export function AdminMerchantPost({ merchantId, ownerId, linked }: { merchantId: string; ownerId?: string | null; linked: MerchantPost }) {
  const { isAdmin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; post: Post | null } | null>(null);
  const [error, setError] = useState('');
  const scope = isAdmin && me.id ? `${me.id}:${merchantId}:${linked.post_id}` : '';
  const key = `${scope}:${revision}`;
  const post = response?.key === key ? response.post : undefined;

  useEffect(() => {
    if (!open || !scope) return;
    let active = true;
    void loadPublicPost(supabase, linked.post_id)
      .then((value) => { if (active) { setResponse({ key, post: value }); setError(''); } })
      .catch(() => { if (active) setError(key); });
    return () => { active = false; };
  }, [key, linked.post_id, open, scope]);

  if (!scope) return null;
  return <details className="merchant-linked-post" open={open} onToggle={(e) => { if (e.currentTarget.open !== open) { play('selection'); setOpen(e.currentTarget.open); } }}>
    <summary><span><strong>{linked.title}</strong><small>{linked.status !== 'published' ? '비공개 · ' : ''}조회 {linked.displayed_views.toLocaleString('ko-KR')} · 업체 링크 클릭 {linked.source_clicks.toLocaleString('ko-KR')}</small></span><span className="merchant-post-toggle">{open ? '접기' : '사진·본문 보기'}</span></summary>
    {open && <div className="merchant-post-content">
      {error === key ? <div role="alert"><p>사진과 본문을 불러오지 못했습니다.</p><button type="button" onClick={() => { play('selection'); setRevision((value) => value + 1); }}>다시 불러오기</button></div>
        : post === undefined ? <p role="status">사진과 본문을 불러오는 중…</p>
        : post === null ? <p>현재 공개 중인 글이 아닙니다. 게시 상태는 게시글 관리에서 확인할 수 있습니다.</p>
        : <><p className="merchant-post-meta">{post.tag.label} · 작성자 {post.author.nickname} <span>{ownerId === post.author.id ? '업체 계정 작성' : '대행·개별 연결'}</span></p>
          {!!post.imageUris?.length && <div className="merchant-post-photos">{post.imageUris.map((_, index) => {
            const image = getPostImageSource(post, me.id, 'full', index);
            return image ? <a key={index} href={image.uri} target="_blank" rel="noopener noreferrer" aria-label={`${post.title} 사진 ${index + 1} 크게 보기`} onClick={() => play('selection')}><img src={image.uri} alt={`${post.title} · 사진 ${index + 1}`} loading="lazy" /></a> : null;
          })}</div>}
          <p className="merchant-post-body">{post.body}</p><a className="merchant-post-open" href={buildSharedPostUrl(linked.post_id)} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>글링에서 글 보기 ↗</a>
        </>}
    </div>}
  </details>;
}

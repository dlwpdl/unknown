import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { GlingRatingIcon, MerchantRatingBar } from '@/components/merchant-rating-bar';
import { PostCard } from '@/components/post-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { isContentRejected } from '@/lib/community-data';
import { appendUniquePosts } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPlaceRatingState, loadPlaceReviews, placeReviewText, PLACE_REVIEW_MAX_LENGTH, writeRatedPlaceReview, type PlaceRatingState, type PlaceReviewPage } from '@/lib/place-reviews';
import { supabase } from '@/lib/supabase';

type Props = { cityId: string; placeId: string; viewport?: { y: number; height: number } };
const SCORES = Array.from({ length: 19 }, (_, index) => 1 + index / 2);

export function PlaceReviews(props: Props) {
  const { tr } = useLanguage();
  const { isAuthed, isAuthLoading, me, promptLogin } = useAuth();
  if (isAuthLoading) return <StateCard kind="pending" title={tr('로그인 확인 중')} body={tr('잠시만 기다려 주세요.')} />;
  if (!isAuthed) return <StateCard kind="blocked" title={tr('장소 후기는 로그인 후 볼 수 있어요')}
    body={tr('장소 정보는 그대로 둘러볼 수 있어요. 로그인하면 회원들의 후기를 읽고 남길 수 있어요.')}
    actionLabel={tr('로그인')} onAction={() => promptLogin(tr('장소 후기를 읽고 남기려면 로그인해 주세요.'))} />;
  return <ScopedPlaceReviews key={`${me.id}:${props.cityId}:${props.placeId}`} {...props} userId={me.id} />;
}

function ScopedPlaceReviews({ cityId, placeId, userId, viewport }: Props & { userId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), hidden = useContentVisibility();
  const { play } = useInteractionFeedback();
  const [page, setPage] = useState<PlaceReviewPage | null>(null);
  const [rating, setRating] = useState<PlaceRatingState | null>(null), [ratingError, setRatingError] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState(false), [retryMore, setRetryMore] = useState(false);
  const [editing, setEditing] = useState(false), [body, setBody] = useState(''), [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState(''), [saved, setSaved] = useState(false);
  const [sectionY, setSectionY] = useState<number | null>(null);
  const [rowLayouts, setRowLayouts] = useState<Record<string, { y: number; height: number }>>({});
  const pageRef = useRef<PlaceReviewPage | null>(null), lifecycle = useRef({ active: false });
  const pendingRead = useRef(false), pendingSave = useRef(false);

  const read = useCallback(async (more = false) => {
    const lifetime = lifecycle.current;
    if (pendingRead.current || !lifetime.active) return;
    pendingRead.current = true;
    setLoading(true); setReadError(false); setRetryMore(more);
    try {
      const next = await loadPlaceReviews(supabase, { cityId, placeId, userId }, more ? pageRef.current?.cursor : null);
      if (!lifetime.active) return;
      const updated = { ...next, posts: more ? appendUniquePosts(pageRef.current?.posts ?? [], next.posts) : next.posts };
      pageRef.current = updated; setPage(updated);
      try {
        const state = await loadPlaceRatingState(supabase, { cityId, placeId, userId }, next.posts.map(post => post.id));
        if (!lifetime.active) return;
        setRating(previous => ({ ...state, scores: more ? { ...previous?.scores, ...state.scores } : state.scores }));
        setRatingError(false);
      } catch {
        if (lifetime.active) setRatingError(true);
      }
    } catch {
      if (lifetime.active) setReadError(true);
    } finally {
      if (lifetime.active) { pendingRead.current = false; setLoading(false); }
    }
  }, [cityId, placeId, userId]);

  useEffect(() => {
    const lifetime = { active: true };
    lifecycle.current = lifetime;
    void read();
    return () => { lifetime.active = false; pendingRead.current = false; };
  }, [read]);

  const publish = async () => {
    if (pendingSave.current || pendingRead.current || !body.trim() || score == null || !rating || ratingError || rating.myReview?.status === 'removed') return;
    pendingSave.current = true; setSaving(true); setWriteError('');
    const lifetime = lifecycle.current;
    const isCurrent = () => lifetime.active;
    try {
      await writeRatedPlaceReview(supabase, { cityId, placeId, userId }, body, score, isCurrent);
      if (!isCurrent()) return;
      setBody(''); setScore(null); setEditing(false); setSaved(true); play('success'); void read();
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '';
      setWriteError(isContentRejected(error) ? '게시 기준을 확인해 주세요. 입력은 남아 있어요.'
        : message === 'INVALID_PLACE_REVIEW' ? '후기는 1~1000자로 적어 주세요. 장소 정보는 자동으로 연결돼요.'
        : message === 'INVALID_PLACE_SCORE' || message.includes('INVALID_PLACE_RATING') ? '1~10점에서 0.5점 단위로 선택해 주세요.'
        : message.includes('PLACE_REVIEW_REMOVED') ? '삭제되거나 숨겨진 리뷰는 수정할 수 없어요.'
        : message === 'ACCOUNT_CHANGED' ? '계정이 바뀌었어요. 현재 계정으로 다시 열어주세요.'
        : '게시 결과를 확인하지 못했어요. 입력은 남아 있어요. 커뮤니티에서 내 글을 확인한 뒤 다시 시도해 주세요.');
      play('warning');
    } finally {
      pendingSave.current = false;
      if (isCurrent()) setSaving(false);
    }
  };
  const visible = page?.posts.filter(post => !hidden('post', post.id, post.author.id)) ?? [];
  const writeDisabled = loading || saving || !rating || ratingError || rating.myReview?.status === 'removed';
  return <View testID="places.reviews.section" onLayout={({ nativeEvent }) => setSectionY(nativeEvent.layout.y)}
    style={[styles.section, { borderTopColor: theme.line }]}>
    <View style={styles.header}>
      <ThemedText type="smallBold" accessibilityRole="header">{tr('글링 회원 후기')}</ThemedText>
      <Pressable analyticsId="places.reviews.refresh" accessibilityRole="button" disabled={loading || saving} accessibilityState={{ disabled: loading || saving }}
        onPress={() => { play('selection'); void read(); }} style={styles.action}>
        <ThemedText type="smallBold" themeColor="accent">{tr('새로고침')}</ThemedText>
      </Pressable>
    </View>
    {rating && <View style={styles.rating}>
      <MerchantRatingBar score={rating.average} label={tr('글링')} />
      <ThemedText type="smallBold">{rating.average == null ? tr('아직 글링 평점이 없어요') : tr('{0}점 / 10점', rating.average.toFixed(1))}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr('글링 {0}개 평가', rating.count)}</ThemedText>
    </View>}
    {ratingError && <ThemedText testID="places.reviews.rating-error" type="small" themeColor="textSecondary" accessibilityRole="alert">
      {tr('평점을 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.')}
    </ThemedText>}
    {rating?.myReview?.status === 'removed' && <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
      {tr('삭제되거나 숨겨진 리뷰는 수정할 수 없어요.')}
    </ThemedText>}
    <ThemedText type="small" themeColor="textSecondary">{tr('회원들이 남긴 글이에요. 실제 방문 여부를 인증한 후기는 아니에요.')}</ThemedText>
    {saved && <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">{tr('후기를 게시했어요. 도시 커뮤니티에서도 볼 수 있어요.')}</ThemedText>}
    {!editing ? <Pressable analyticsId="places.reviews.write" accessibilityRole="button"
      disabled={writeDisabled} accessibilityState={{ disabled: writeDisabled }}
      onPress={() => {
        play('selection');
        if (!body.trim() && rating?.myReview) setBody(placeReviewText(rating.myReview.body));
        if (score == null) setScore(rating?.myReview?.score ?? null);
        setEditing(true); setWriteError(''); setSaved(false);
      }} style={[styles.action, styles.write, { borderColor: theme.line, opacity: writeDisabled ? 0.5 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent">{tr(rating?.myReview ? '내 리뷰 수정' : '후기 남기기')}</ThemedText>
    </Pressable> : <View style={[styles.editor, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <ThemedText type="small">{tr('게시하면 이 장소의 후기와 도시 커뮤니티에 일반 글로 표시돼요. 장소 링크와 지도는 자동으로 붙어요.')}</ThemedText>
      <ThemedText type="smallBold">{score == null ? tr('점수를 선택해 주세요') : tr('{0}점 / 10점', score.toFixed(1))}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr('최저 1점 · 최고 10점 · 0.5점 단위')}</ThemedText>
      <View style={styles.scores} accessibilityRole="radiogroup" accessibilityLabel={tr('장소 후기 점수')}>
        {SCORES.map(value => <Pressable key={value} analyticsId="places.reviews.score" testID={`places.reviews.score.${value}`}
          accessibilityRole="radio" accessibilityLabel={tr('{0}점', value)} aria-checked={value === score} accessibilityState={{ checked: value === score, disabled: saving }} disabled={saving}
          onPress={() => { play('selection'); setScore(value); }}
          style={[styles.score, { borderColor: value === score ? theme.accent : theme.line, backgroundColor: value === score ? theme.accent : theme.background }]}>
          <ThemedText type="smallBold" style={{ color: value === score ? theme.accentInk : theme.text }}>{value}</ThemedText>
        </Pressable>)}
      </View>
      <TextInput testID="places.reviews.body" accessibilityLabel={tr('장소 후기 내용')} multiline textAlignVertical="top"
        value={body} onChangeText={setBody} onFocus={() => play('selection')} editable={!saving} maxLength={PLACE_REVIEW_MAX_LENGTH}
        placeholder={tr('직접 겪은 경험을 적어 주세요. 개인 연락처 등 민감한 정보는 쓰지 마세요.')} placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
      <ThemedText type="small" themeColor="textSecondary">{tr('{0}/1000자', [...body].length)}</ThemedText>
      {!!writeError && <ThemedText type="small" accessibilityRole="alert" themeColor="textSecondary">{tr(writeError)}</ThemedText>}
      <RaisedActionButton analyticsId="places.reviews.publish" label={tr(saving ? '게시 중…' : '후기 게시')}
        disabled={writeDisabled || score == null || !body.trim() || [...body.trim()].length > PLACE_REVIEW_MAX_LENGTH} busy={saving}
        onPress={() => { play('selection'); void publish(); }} />
      <Pressable analyticsId="places.reviews.cancel" accessibilityRole="button" disabled={saving} accessibilityState={{ disabled: saving }}
        onPress={() => { play('selection'); setEditing(false); }} style={styles.action}>
        <ThemedText type="smallBold" themeColor="textSecondary">{tr('닫기')}</ThemedText>
      </Pressable>
    </View>}
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{tr('후기 불러오는 중…')}</ThemedText>}
    {readError && <StateCard kind="error" title={tr('장소 후기를 불러오지 못했어요')}
      body={tr('이미 읽은 글과 작성 중인 내용은 남아 있어요. 연결을 확인한 뒤 다시 시도해 주세요.')}
      actionLabel={tr('다시 시도')} onAction={() => { void read(retryMore); }} />}
    {page && !loading && !readError && !visible.length && <StateCard kind="empty"
      title={tr(page.hasMore ? '이 페이지에는 장소 후기가 없어요' : '표시할 장소 후기가 없어요')}
      body={tr(page.hasMore ? '더 불러오기로 이전 글을 확인할 수 있어요.' : '경험을 나누고 싶다면 첫 후기를 남겨 주세요.')} />}
    {(expanded ? visible : visible.slice(0, 3)).map(post => {
      const row = rowLayouts[post.id];
      const translationVisible = !!(viewport && viewport.height > 0 && sectionY != null && row?.height > 0
        && Math.max(0, Math.min(sectionY + row.y + row.height, viewport.y + viewport.height)
          - Math.max(sectionY + row.y, viewport.y)) >= Math.min(row.height, viewport.height) * 0.5);
      return <View key={`${userId}:${post.id}`} testID={`places.reviews.row.${post.id}`} onLayout={({ nativeEvent: { layout } }) => {
        setRowLayouts(previous => previous[post.id]?.y === layout.y && previous[post.id]?.height === layout.height ? previous
          : { ...previous, [post.id]: { y: layout.y, height: layout.height } });
      }}>
        {rating?.scores[post.id] != null && <ThemedText type="smallBold" accessibilityLabel={tr('{0}점, 10점 만점', rating.scores[post.id])}>
          <GlingRatingIcon score={rating.scores[post.id]} />{' '}{rating.scores[post.id].toFixed(1)} / 10
        </ThemedText>}
        <PostCard post={{ ...post, body: placeReviewText(post.body) }} flat translationVisible={translationVisible}
          onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
          onAuthor={() => { if (post.business) router.push({ pathname: '/company/[id]', params: { id: post.business.id } }); else if (post.author.id) router.push({ pathname: '/user/[id]', params: { id: post.author.id } }); }} />
      </View>;
    })}
    {(page?.hasMore || !expanded && visible.length > 3) && <Pressable analyticsId="places.reviews.more" accessibilityRole="button" disabled={loading || saving} accessibilityState={{ disabled: loading || saving }}
      onPress={() => { play('selection'); setExpanded(true); if (expanded || visible.length <= 3) void read(true); }} style={styles.action}>
      <ThemedText type="smallBold" themeColor="accent">{tr('후기 더 불러오기')}</ThemedText>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  action: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  write: { borderWidth: 1, borderRadius: 14, alignSelf: 'flex-start' },
  editor: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  rating: { gap: Spacing.one },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  score: { minWidth: 44, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 132, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16, lineHeight: 24 },
});

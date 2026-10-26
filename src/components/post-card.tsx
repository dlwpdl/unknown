import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Alert, Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PostAdLabel } from '@/components/post-ad-label';
import { PostBody } from '@/components/post-body';
import { PostMapLink } from '@/components/post-map-link';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { postInfoParts } from '@/lib/post-info';
import { CITIES } from '@/lib/mock';
import { TranslationControl } from '@/components/content-translation';
import { useContentTranslation } from '@/hooks/use-content-translation';
import { visibleTranslationSource } from '@/lib/translation-source';
import { splitPostPhotoCredits } from '@/lib/post-photo-credits';
import { instagramPostLink, splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { recordPostShare, togglePostReaction } from '@/lib/community-data';
import { getPostImageSource, relativeTime } from '@/lib/feed-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { uniqueHashtags } from '@/lib/hashtags';
import { postLocationUrl, postMapBody } from '@/lib/post-maps';
import { changePostReaction, postReactionsSnapshot, subscribePostReactions, syncPostReactions } from '@/lib/post-reactions';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PostShareSheet } from '@/components/post-share-sheet';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export function PostCard({
  post,
  onJoin,
  onHashtag,
  onAuthor,
  onPress,
  hidePhoto,
  hideRoom = false,
  flat = false,
  afterBody,
  translationVisible = true,
  meetupDetail,
  postDetail = false,
}: {
  post: Post;
  onJoin?: () => void;
  onHashtag?: (h: string) => void; // 해시태그 탭 → 검색/필터
  onAuthor?: () => void; // 작성자 탭 → 미니 프로필
  onPress?: () => void;
  hidePhoto?: boolean; // 상세 화면은 갤러리가 사진을 대신 보여준다
  hideRoom?: boolean;
  flat?: boolean;
  afterBody?: ReactNode;
  translationVisible?: boolean;
  meetupDetail?: { beforeTitle: ReactNode; afterTitle: ReactNode }; // 모임 상세: 작성자 줄·분류·반응 줄 대신 요약을 끼운다
  postDetail?: boolean; // 일반 글 상세: 장소·링크는 정보 카드, 본문은 문단, 출처는 접고, 반응은 하단 바로 옮긴다
}) {
  const { tr, t, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [saveBurst] = useState(() => new Animated.Value(0));
  const openPost = () => { play('selection'); onPress?.(); };
  const mine = !post.business && post.author.id === me.id;
  const viewerId = isAuthed ? me.id : 'guest';
  const reactions = useSyncExternalStore(subscribePostReactions,
    useCallback(() => postReactionsSnapshot(viewerId, post.id), [viewerId, post.id]), () => undefined);
  const likedOn = reactions?.like?.isOn ?? post.likedByMe ?? false;
  const savedOn = reactions?.save?.isOn ?? post.savedByMe ?? false;
  const likeCount = reactions?.like?.count ?? post.likes;
  const saveCount = reactions?.save?.count ?? post.saves;
  const busyReaction = reactions?.pending ?? null;
  useEffect(() => {
    syncPostReactions(viewerId, post.id, { isOn: post.likedByMe ?? false, count: post.likes }, { isOn: post.savedByMe ?? false, count: post.saves });
  }, [viewerId, post.id, post.likedByMe, post.likes, post.savedByMe, post.saves]);
  const [shareCount, setShareCount] = useState(post.shares ?? 0);
  const [reportOpen, setReportOpen] = useState(false);
  const [failedBusinessLogo, setFailedBusinessLogo] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<{ postId: string; uri: string } | null>(null);
  const [loadedPhoto, setLoadedPhoto] = useState<{ key: string; aspectRatio: number } | null>(null);
  const [introLines, setIntroLines] = useState<{ body: string; lines: number } | null>(null), [introOpen, setIntroOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const isMeetup = post.tag.kind === 'meetup';
  const isListing = post.kind === 'listing';
  const viewerScope = isAuthed ? me.id : 'guest';
  const photoSource = getPostImageSource(post, viewerScope);
  const firstPhoto = photoSource?.uri;
  const photoKey = `${viewerScope}:${post.id}:${firstPhoto}`;
  const photoAspectRatio = loadedPhoto?.key === photoKey ? loadedPhoto.aspectRatio : 16 / 10;
  const photo = hidePhoto || (failedPhoto?.postId === post.id && failedPhoto.uri === firstPhoto) ? undefined : firstPhoto;
  const photoCount = post.imagePaths?.length ?? 0;
  const chips = uniqueHashtags([post.author.neighborhood, ...(post.hashtags ?? [])]);
  const mapped = postMapBody(post.body);
  const source = visibleTranslationSource('post', post.title, post.body, !!post.room);
  const translation = useContentTranslation('post', post.id, source, translationVisible);
  const originalBody = post.room ? visibleMeetupBody(mapped.body) : mapped.body;
  const attached = splitPostAttachments(originalBody);
  const credited = splitPostPhotoCredits(attached.body);
  const displayBody = translation.translated && !translation.original
    ? withPostAttachments(translation.display.body + (credited.credits ? attached.body.slice(credited.body.length) : ''), attached.urls)
    : originalBody;
  // shortcut: measured once per body text, so a later font-size change keeps the first line count until the text changes.
  const measuredLines = introLines?.body === displayBody ? introLines.lines : null;
  const introLong = !!meetupDetail && measuredLines != null && measuredLines > 4;
  const shown = splitPostAttachments(displayBody);
  const info = postDetail ? postInfoParts(shown.body) : null;
  const infoLinks = info ? [...new Set([...shown.urls.map(url => instagramPostLink(url)?.url ?? url), ...info.links])] : [];
  const infoPlace = !info ? null : mapped.url ? { url: mapped.url, label: mapped.label }
    : info.place ? { url: postLocationUrl(info.place, CITIES.find(city => city.id === post.cityId)?.englishName), label: info.place } : null;
  const bodyText = <PostBody
    themeColor={meetupDetail || info ? 'text' : 'textSecondary'}
    paragraphs={info?.paragraphs}
    style={[styles.body, post.room && flat && styles.meetupBody, info && styles.detailBody]}
    numberOfLines={onPress ? 3 : introLong && !introOpen ? 4 : undefined}
    onTextLayout={meetupDetail && measuredLines == null ? (event) => setIntroLines({ body: displayBody, lines: event.nativeEvent.lines.length }) : undefined}
    linksEnabled={!onPress}
    body={displayBody} />;

  const toggleLike = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonLike);
    if (busyReaction) return;
    play('reaction');
    try {
      await changePostReaction(me.id, post.id, 'like', { isOn: likedOn, count: likeCount },
        previous => togglePostReaction(supabase, post.id, me.id, 'like', previous));
    } catch {
      play('warning');
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    }
  };

  const toggleSave = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonSave);
    if (busyReaction) return;
    play('reaction');
    const previous = savedOn;
    if (!previous && !reducedMotion) {
      saveBurst.stopAnimation();
      saveBurst.setValue(0);
      Animated.timing(saveBurst, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    try {
      await changePostReaction(me.id, post.id, 'save', { isOn: savedOn, count: saveCount },
        wasOn => togglePostReaction(supabase, post.id, me.id, 'save', wasOn));
    } catch {
      play('warning');
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    }
  };

  const share = () => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonShare);
    setShareOpen(true);
  };

  return (
    <View
      style={flat ? undefined : [
        styles.card,
        photo ? styles.photoCard : styles.textCard,
        { backgroundColor: theme.card },
      ]}>
      <View style={[styles.content, photo && !flat && styles.photoContent]}>
        {!meetupDetail && <View style={styles.head}>
          <Pressable analyticsId="components_post-card.pressable.4"
            onPress={() => { play('reaction'); onAuthor?.(); }}
            disabled={!onAuthor}
            accessibilityRole={onAuthor ? 'button' : undefined}
            style={({ pressed }) => [styles.author, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent', transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <View style={[styles.avatar, { backgroundColor: mine ? theme.accent : theme.backgroundElement }]}>
              {post.business?.avatarUri && failedBusinessLogo !== post.business.avatarUri ? <Image
                source={{ uri: post.business.avatarUri }} style={{ width: 32, height: 32, borderRadius: 16 }} contentFit="cover"
                accessibilityIgnoresInvertColors onError={() => setFailedBusinessLogo(post.business!.avatarUri!)} /> :
              <ThemedText type="smallBold" style={{ color: mine ? theme.accentInk : theme.navy }}>
                {(post.business?.name ?? post.author.nickname)[0]}
              </ThemedText>}
            </View>
            <View style={styles.authorCopy}>
              <View style={styles.nickRow}>
                <ThemedText type="smallBold" style={styles.nickname}>{post.business?.name ?? post.author.nickname}</ThemedText>
                {post.business ? <ThemedText type="small" themeColor="textSecondary">{tr('비즈니스')}</ThemedText> : post.room ? <ThemedText type="small" themeColor="textSecondary">{tr('모임 호스트')}</ThemedText> : <TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} />}
                <PostAdLabel hashtags={post.hashtags} />
                {mine && (
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {t.feed.mineBadge}
                  </ThemedText>
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                {post.createdAt ? relativeTime(post.createdAt, undefined, appLocale) : post.createdAtLabel}{post.bumpedAt ? ` · ${t.detail.bumpedLabel}` : ''}{postDetail ? ` · ${t.feed.views(post.views)}` : ''}
              </ThemedText>
            </View>
          </Pressable>
          {!mine && (
            <Pressable lens analyticsId="components_post-card.pressable.5"
              onPress={() => { play('reaction'); if (isAuthed) setReportOpen(true); else promptLogin(t.auth.reasonReport); }}
              accessibilityRole="button"
              accessibilityLabel={t.report.title(post.business?.name ?? post.author.nickname)}
              style={({ pressed }) => [styles.more, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent', transform: [{ scale: pressed ? 0.88 : 1 }] }]}>
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={22}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          )}
        </View>}

        <Pressable analyticsId="components_post-card.pressable.2"
          onPress={openPost}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? `${tr(post.tag.label)} · ${translation.display.title}` : undefined}
          style={({ pressed }) => pressed && styles.pressed}>
          {meetupDetail ? meetupDetail.beforeTitle : <ThemedText
            type="smallBold"
            style={[styles.category, { color: isMeetup ? theme.accent : theme.textSecondary }]}>
            {tr(post.tag.label)}{isListing ? ` · ${t.detail.listingBadge}` : ''}
          </ThemedText>}
          <ThemedText accessibilityRole={meetupDetail ? 'header' : undefined} style={[styles.title, flat && !onPress && styles.detailTitle, meetupDetail && Typography.sheetTitle]}>
            {translation.display.title}
          </ThemedText>
          {photo && (
            <View style={styles.photoMedia}>
              <Image
                key={photoKey}
                source={photoSource}
                accessibilityLabel={`${t.feed.postImage} · ${post.title}`}
                style={[styles.postImage, flat && styles.flatPostImage, { aspectRatio: photoAspectRatio, backgroundColor: theme.backgroundElement }]}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={`${viewerScope}:${post.id}`}
                transition={0}
                onLoad={({ source: { width, height } }) => {
                  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                    setLoadedPhoto({ key: photoKey, aspectRatio: width / height });
                  }
                }}
                onError={() => setFailedPhoto({ postId: post.id, uri: photo })}
              />
              {photoCount > 1 && (
                <View style={styles.photoCount}>
                  <ThemedText type="smallBold" style={styles.photoCountText}>{`1/${photoCount}`}</ThemedText>
                </View>
              )}
            </View>
          )}
          {info && (infoPlace?.url || infoLinks.length > 0) && <View style={styles.info}>
            {infoPlace?.url && <PostMapLink url={infoPlace.url} label={infoPlace.label} />}
            {infoLinks.length > 0 && <View style={[styles.infoLinks, { borderColor: theme.line }]}>
              {infoLinks.map((url, index) => <View key={url} style={index > 0 && [styles.infoDivider, { borderTopColor: theme.line }]}><PostAttachmentLink url={url} row /></View>)}
            </View>}
          </View>}
          {!meetupDetail && (info ? <View style={styles.detailBodyWrap}>{bodyText}</View> : bodyText)}
          {isListing && (post.price != null || (post.listingStatus && post.listingStatus !== 'open')) && (
            <View style={styles.listingLine}>
              {post.price != null && <ThemedText style={styles.price}>{t.detail.price(post.price)}</ThemedText>}
              {post.listingStatus && post.listingStatus !== 'open' && (
                <ThemedText type="small" themeColor="textSecondary">{t.detail.listingStatus[post.listingStatus]}</ThemedText>
              )}
            </View>
          )}
        </Pressable>
        {meetupDetail && <>
          {meetupDetail.afterTitle}
          <View style={[styles.intro, { borderTopColor: theme.line }]}>
            <ThemedText accessibilityRole="header" style={Typography.section}>{tr('소개')}</ThemedText>
            {bodyText}
            {introLong && <Pressable analyticsId="meetup.detail.intro-more" accessibilityRole="button" accessibilityState={{ expanded: introOpen }}
              onPress={() => { play('selection'); setIntroOpen(value => !value); }} style={styles.introMore}>
              <ThemedText type="smallBold" themeColor="accent">{introOpen ? tr('접기') : tr('더 보기')}</ThemedText>
            </Pressable>}
          </View>
        </>}

        <TranslationControl translation={translation} />
        {!info && mapped.url && <PostMapLink url={mapped.url} label={mapped.label} />}
        {afterBody}

        {chips.length > 0 && (
          <View style={styles.hashRow}>
            {chips.map((chip) => (
              <Pressable analyticsId="components_post-card.pressable.3"
                key={chip}
                onPress={onHashtag ? () => {
                  play('selection');
                  onHashtag(chip);
                } : undefined}
                disabled={!onHashtag}
                accessibilityRole={onHashtag ? 'button' : undefined}
                accessibilityLabel={t.feed.hashtagFilter(chip)}
                style={({ pressed }) => [styles.hash, pressed && styles.pressed]}>
                <ThemedText type="small" style={{ color: theme.navy }}>
                  {'#' + chip}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        {info && info.credits.length > 0 && <View style={[styles.credits, { borderTopColor: theme.line }]}>
          <Pressable analyticsId="post.detail.credits" accessibilityRole="button" accessibilityState={{ expanded: creditsOpen }}
            onPress={() => { play('selection'); setCreditsOpen(value => !value); }} style={styles.creditsToggle}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={{ flex: 1 }}>{tr("출처·사진 정보 {0}", info.credits.length)}</ThemedText>
            <SymbolView name={{ ios: creditsOpen ? 'chevron.up' : 'chevron.down', android: creditsOpen ? 'expand_less' : 'expand_more', web: creditsOpen ? 'expand_less' : 'expand_more' }} size={14} tintColor={theme.textSecondary} />
          </Pressable>
          {creditsOpen && <PostBody body="" paragraphs={info.credits} type="small" themeColor="textSecondary" />}
        </View>}

        {post.room && !hideRoom && (
          <View style={[styles.module, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.roomInfo}>
              <SymbolView
                name={{ ios: 'person.2', android: 'group', web: 'group' }}
                size={28}
                tintColor={theme.accent}
              />
              <View style={styles.roomCopy}>
                <ThemedText type="smallBold" style={styles.roomTitle}>
                  {post.room.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                  {[
                    post.room.closed ? t.meetup.closed : null,
                    post.room.verifiedOnly ? t.feed.roomGate : null,
                    t.feed.members(post.room.memberCount, post.room.capacity),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
            </View>
            {onJoin && !post.room.closed && (
              <Pressable lens analyticsId="components_post-card.pressable.6"
                onPress={() => { play('selection'); onJoin(); }}
                style={({ pressed }) => [styles.join, { backgroundColor: theme.accent }, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.feed.joinRoom}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                  {t.feed.joinRoom}
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}

        {!meetupDetail && !postDetail && <View style={[styles.foot, flat && styles.flatFoot, { borderTopColor: theme.line }]}>
          <Pressable lens analyticsId="components_post-card.pressable.7"
            onPress={toggleLike}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.likes(likeCount)}
            accessibilityState={{ selected: likedOn, disabled: !!busyReaction, busy: busyReaction === 'like' }}>
            <SymbolView
              name={{ ios: likedOn ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' }}
              size={20}
              tintColor={likedOn ? theme.accent : theme.textSecondary}
            />
            <ThemedText
              type={likedOn ? 'smallBold' : 'small'}
              style={[styles.footItem, { color: likedOn ? theme.accent : theme.textSecondary }]}>
              {count(likeCount)}
            </ThemedText>
          </Pressable>
          <Pressable lens analyticsId="components_post-card.pressable.8"
            onPress={openPost}
            disabled={!onPress}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={t.feed.comments(post.comments)}>
            <SymbolView
              name={{ ios: 'bubble.right', android: 'chat_bubble', web: 'chat_bubble' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {count(post.comments)}
            </ThemedText>
          </Pressable>
          <Pressable lens analyticsId="components_post-card.pressable.9"
            onPress={toggleSave}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.saves(saveCount)}
            accessibilityState={{ selected: savedOn, disabled: !!busyReaction, busy: busyReaction === 'save' }}>
            <Animated.View style={[styles.saveMark, { transform: reducedMotion ? undefined : [{ scale: saveBurst.interpolate({ inputRange: [0, 0.28, 0.65, 1], outputRange: [1, 1.27, 0.95, 1] }) }] }]}>
              {!reducedMotion && [[-12, -12], [0, -17], [12, -12], [-14, 5], [14, 5], [0, 16]].map(([x, y], index) => <Animated.View key={index} pointerEvents="none" style={[styles.saveSpark, {
                backgroundColor: index % 2 ? '#F9C76C' : theme.accent,
                opacity: saveBurst.interpolate({ inputRange: [0, 0.15, 0.65, 1], outputRange: [0, 1, 0.75, 0] }),
                transform: [
                  { translateX: saveBurst.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
                  { translateY: saveBurst.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
                ],
              }]} />)}
              <SymbolView
                name={{ ios: savedOn ? 'bookmark.fill' : 'bookmark', android: savedOn ? 'bookmark_added' : 'bookmark', web: savedOn ? 'bookmark_added' : 'bookmark' }}
                size={20}
                tintColor={savedOn ? theme.accent : theme.textSecondary}
              />
            </Animated.View>
            <ThemedText
              type={savedOn ? 'smallBold' : 'small'}
              style={[styles.footItem, { color: savedOn ? theme.accent : theme.textSecondary }]}>
              {count(saveCount)}
            </ThemedText>
          </Pressable>
          <Pressable lens analyticsId="components_post-card.pressable.10"
            onPress={() => void share()}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={tr("{0} · {1}", (tr(post.room ? '모임 초대 링크 공유' : '게시물 링크 공유')), (t.feed.shares(shareCount)))}>
            <SymbolView
              name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {post.room ? tr("초대") : tr("공유")}{shareCount > 0 ? ` · ${count(shareCount)}` : ''}
            </ThemedText>
          </Pressable>
          <View style={styles.reaction} accessible accessibilityLabel={t.feed.views(post.views)}>
            <SymbolView
              name={{ ios: 'eye', android: 'visibility', web: 'visibility' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {count(post.views)}
            </ThemedText>
          </View>
        </View>}
      </View>
      {shareOpen && <PostShareSheet key={`${post.id}:${me.id}`} post={post} visible={shareOpen} onClose={() => setShareOpen(false)}
        onShared={() => { void recordPostShare(supabase, post.id).then(setShareCount).catch(() => {}); }} />}
      <ReportSheet
        visible={reportOpen}
        targetType="post"
        targetId={post.id}
        reportedUserId={post.business ? undefined : post.author.id}
        reportedBusinessId={post.business?.id}
        reportedNickname={post.business?.name ?? post.author.nickname}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

/** Like/save toggle for detail layouts without the reaction row; shares the card's reaction store. */
export function PostReactionToggle({ post, kind, showCount = false }: { post: Post; kind: 'like' | 'save'; showCount?: boolean }) {
  const { t } = useLanguage();
  const theme = useTheme();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const viewerId = isAuthed ? me.id : 'guest';
  const reactions = useSyncExternalStore(subscribePostReactions,
    useCallback(() => postReactionsSnapshot(viewerId, post.id), [viewerId, post.id]), () => undefined);
  const like = kind === 'like';
  const on = reactions?.[kind]?.isOn ?? (like ? post.likedByMe : post.savedByMe) ?? false;
  const total = reactions?.[kind]?.count ?? (like ? post.likes : post.saves);
  const busy = reactions?.pending ?? null;
  const toggle = async () => {
    if (!isAuthed) return promptLogin(like ? t.auth.reasonLike : t.auth.reasonSave);
    if (busy) return;
    play('reaction');
    try {
      await changePostReaction(me.id, post.id, kind, { isOn: on, count: total },
        wasOn => togglePostReaction(supabase, post.id, me.id, kind, wasOn));
    } catch {
      play('warning');
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    }
  };
  const icon = like ? { ios: on ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' } as const
    : { ios: on ? 'bookmark.fill' : 'bookmark', android: on ? 'bookmark_added' : 'bookmark', web: on ? 'bookmark_added' : 'bookmark' } as const;
  return <Pressable analyticsId={like ? 'post.detail.like' : 'post.detail.save'} onPress={() => void toggle()} disabled={!!busy} accessibilityRole="button"
    accessibilityLabel={like ? t.feed.likes(total) : t.feed.saves(total)}
    accessibilityState={{ selected: on, disabled: !!busy, busy: busy === kind }} style={({ pressed }) => [styles.more, showCount && styles.reactionToggle, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <SymbolView name={icon} size={21} tintColor={on ? theme.accent : theme.text} />
    {showCount && total > 0 && <ThemedText type="smallBold" style={{ color: on ? theme.accent : theme.textSecondary }}>{count(total)}</ThemedText>}
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  photoCard: { borderRadius: 24 },
  photoCount: { position: 'absolute', bottom: 10, right: 10, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(22,22,24,0.66)' },
  photoCountText: { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  textCard: { borderRadius: 16, paddingHorizontal: Spacing.three },
  content: { paddingVertical: Spacing.three },
  photoContent: { paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.65 },
  postImage: { width: '100%' },
  flatPostImage: { borderRadius: 16 },
  photoMedia: { marginTop: Spacing.three, borderRadius: 16, overflow: 'hidden' },
  category: { fontSize: 12, lineHeight: 18, marginBottom: Spacing.one },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5 },
  detailTitle: { fontSize: 28, lineHeight: 36, letterSpacing: -0.6 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: Spacing.two },
  detailBody: { fontSize: 16, lineHeight: 27, marginTop: 0 },
  detailBodyWrap: { marginTop: Spacing.three },
  info: { marginTop: Spacing.one, gap: Spacing.two },
  infoLinks: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  infoDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  credits: { marginTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.one },
  creditsToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  meetupBody: { fontSize: 16, lineHeight: 24 },
  listingLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, marginTop: Spacing.two },
  price: { fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  hashRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three },
  hash: { minHeight: 44, minWidth: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  author: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12 },
  authorCopy: { flex: 1 },
  nickRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  nickname: { flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18 },
  avatar: { minWidth: 32, minHeight: 32, borderRadius: 16, padding: Spacing.one, alignItems: 'center', justifyContent: 'center' },
  more: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  reactionToggle: { flexDirection: 'row', gap: 4, paddingHorizontal: 6 },
  introMore: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  intro: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one },
  module: { marginTop: Spacing.three, borderRadius: 16, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  roomInfo: { flexGrow: 1, flexBasis: 152, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  roomCopy: { flex: 1 },
  roomTitle: { fontSize: 15, lineHeight: 22 },
  join: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.three, paddingTop: Spacing.one },
  flatFoot: { borderTopWidth: 0, paddingTop: 0 },
  reaction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, minWidth: 44, minHeight: 44 },
  saveMark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  saveSpark: { position: 'absolute', left: 9, top: 8, width: 4, height: 8, borderRadius: 2 },
  footItem: { fontVariant: ['tabular-nums'] },
});

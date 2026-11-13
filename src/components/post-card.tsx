import { useLanguage } from '@/hooks/use-language';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { ClayBoxFill, ClayCoinFill, ClayIcon, ClayPhoto, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { Alert, Animated, DeviceEventEmitter, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PostAdLabel } from '@/components/post-ad-label';
import { PostBody } from '@/components/post-body';
import { PostMapLink } from '@/components/post-map-link';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { dealLabel } from '@/lib/listing-details';
import { postInfoParts } from '@/lib/post-info';
import { CITIES } from '@/lib/mock';
import { TranslationControl } from '@/components/content-translation';
import { useContentTranslation } from '@/hooks/use-content-translation';
import { businessDisclosureLines, splitProxyDisclosure, visibleTranslationSource } from '@/lib/translation-source';
import { photoCreditNames, splitPostPhotoCredits } from '@/lib/post-photo-credits';
import { instagramPostLink, splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { PostPlaceCard } from '@/components/post-place-card';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { deletePost, recordPostShare, setPostHidden, togglePostReaction } from '@/lib/community-data';
import { getPostImageSource, relativeTime } from '@/lib/feed-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { mapPinPlace, placeReviewPlace, placeReviewText } from '@/lib/place-reviews';
import { uniqueHashtags } from '@/lib/hashtags';
import { postLocationUrl, postMapBody } from '@/lib/post-maps';
import { changePostReaction, postReactionsSnapshot, subscribePostReactions, syncPostReactions } from '@/lib/post-reactions';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { handOffPost, POST_CHANGED_EVENT, type PostChange } from '@/lib/post-open';
import { PostShareSheet } from '@/components/post-share-sheet';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';
import { parseMeetupSections } from '@/lib/meetup-sections';
import { MeetupSectionsView } from '@/components/meetup-sections';

// Today feed card (owner 2026-11-03 mockup): a 40pt avatar column; text, place card, photos and reactions line up after it.
const FEED_AVATAR = 40, FEED_TEXT_INSET = FEED_AVATAR + 10, FEED_PHOTO_INSET = Spacing.three + FEED_TEXT_INSET, FEED_PEEK = 20;

export function PostCard({
  post,
  onJoin,
  joinStatus,
  onHashtag,
  onAuthor,
  onPress,
  hidePhoto,
  hideRoom = false,
  flat = false,
  afterBody,
  beforeBody,
  translationVisible = true,
  meetupDetail,
  postDetail = false,
  feed = false,
}: {
  post: Post;
  onJoin?: () => void;
  joinStatus?: 'pending' | 'approved';
  onHashtag?: (h: string) => void; // 해시태그 탭 → 검색/필터
  onAuthor?: () => void; // 작성자 탭 → 미니 프로필
  onPress?: () => void;
  hidePhoto?: boolean; // 상세 화면은 갤러리가 사진을 대신 보여준다
  hideRoom?: boolean;
  flat?: boolean;
  afterBody?: ReactNode;
  beforeBody?: ReactNode; // 부동산·구인구직·중고거래 상세: 항목 카드가 가격 줄을 대신한다
  translationVisible?: boolean;
  meetupDetail?: { beforeTitle: ReactNode; afterTitle: ReactNode }; // 모임 상세: 작성자 줄·분류·반응 줄 대신 요약을 끼운다
  postDetail?: boolean; // 일반 글 상세: 장소·링크는 정보 카드, 본문은 문단, 출처는 접고, 반응은 하단 바로 옮긴다
  feed?: boolean; // 오늘 탭 목록 (owner 2026-11-03): 프로필 줄 → 짧은 글 → 장소 카드 → 넘기는 사진 → 공감·댓글·공유·저장(오른쪽 끝). ··· 은 남의 글 숨기기·신고, 내 글 고치기·삭제 (owner 2026-11-04)
}) {
  const { tr, t, locale: appLocale, language } = useLanguage();
  const joinLabel = joinStatus === 'pending' ? tr('승인 대기') : joinStatus === 'approved' ? tr('참여 승인') : t.feed.joinRoom;
  const theme = useTheme(), router = useRouter();
  const clay = useClay(), clayBox = useClayBox();
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
  const cardLogo = !!post.business?.avatarUri && failedBusinessLogo !== post.business.avatarUri;
  const authorPhoto = !post.business && post.author.avatarUrl !== failedBusinessLogo ? post.author.avatarUrl : undefined;
  const [shareOpen, setShareOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<{ postId: string; uri: string } | null>(null);
  const [loadedPhoto, setLoadedPhoto] = useState<{ key: string; aspectRatio: number } | null>(null);
  const [introLines, setIntroLines] = useState<{ body: string; lines: number } | null>(null), [introOpen, setIntroOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false), [deleteOpen, setDeleteOpen] = useState(false);
  const [textLines, setTextLines] = useState<{ text: string; lines: number } | null>(null), [textOpen, setTextOpen] = useState(false);
  const [photoPage, setPhotoPage] = useState(0), [photoRowWidth, setPhotoRowWidth] = useState(0), [failedSlides, setFailedSlides] = useState<string[]>([]);
  const isMeetup = post.tag.kind === 'meetup';
  const isListing = post.kind === 'listing';
  // 칸이 있는 글은 그 글의 종류(구인·렌트 내놓음·팝니다)로 적는다. '구해요·팔아요'로는 구인·렌트 글이 중고거래처럼 읽힌다(QA H43-7·B12-2). 피드 카드와 상세가 같은 이름을 쓴다.
  const listingKind = post.listingDetails ? dealLabel(post.listingDetails, language) : t.detail.listingBadge;
  const viewerScope = isAuthed ? me.id : 'guest';
  const photoSource = getPostImageSource(post, viewerScope);
  const firstPhoto = photoSource?.uri;
  const photoKey = `${viewerScope}:${post.id}:${firstPhoto}`;
  const photoAspectRatio = loadedPhoto?.key === photoKey ? loadedPhoto.aspectRatio : 16 / 10;
  const photo = hidePhoto || (failedPhoto?.postId === post.id && failedPhoto.uri === firstPhoto) ? undefined : firstPhoto;
  const photoCount = post.imagePaths?.length ?? 0;
  const chips = uniqueHashtags([post.author.neighborhood, ...(post.hashtags ?? [])]);
  // Gling's proxy-post line becomes a mark under the author; the meetup summary has no author row, so there it stays in the body.
  // The feed shows the place a post is already tied to (a place meetup or a place review) as a card; a review's text then drops its score and reference lines.
  const reviewPlace = useMemo(() => feed && !post.room ? placeReviewPlace(post) : null, [feed, post]);
  // A place picked from the Gling map while writing gets the same card in the feed and the post detail (owner 2026-11-11).
  // Merchant web has no /map route, so there a post keeps its small map.
  const linkedPlace = useMemo(() => feed && post.room ? splitPlaceMeetupBody(post.body, post.cityId)?.place ?? null
    : reviewPlace ?? ((feed || postDetail) && !post.room && Platform.OS !== 'web' ? mapPinPlace(post.cityId, postMapBody(post.body).url) : null),
  [feed, postDetail, post, reviewPlace]);
  const proxied = meetupDetail ? { body: post.body, proxy: false } : splitProxyDisclosure(reviewPlace ? placeReviewText(post.body) : post.body);
  const mapped = postMapBody(proxied.body);
  const source = visibleTranslationSource('post', post.title, proxied.body, !!post.room);
  const translation = useContentTranslation('post', post.id, source, translationVisible);
  const originalBody = post.room ? visibleMeetupBody(mapped.body) : mapped.body;
  const attached = splitPostAttachments(originalBody);
  const credited = splitPostPhotoCredits(attached.body);
  const displayBody = translation.translated && !translation.original
    ? withPostAttachments(translation.display.body + businessDisclosureLines(credited.body).map(line => `\n\n${line}`).join('') + (credited.credits ? attached.body.slice(credited.body.length) : ''), attached.urls)
    : originalBody;
  // shortcut: measured once per body text, so a later font-size change keeps the first line count until the text changes.
  const measuredLines = introLines?.body === displayBody ? introLines.lines : null;
  const introLong = !!meetupDetail && measuredLines != null && measuredLines > 4;
  const shown = splitPostAttachments(displayBody);
  const info = postDetail ? postInfoParts(shown.body) : null;
  const meetupSections = meetupDetail ? parseMeetupSections(shown.body) : null;
  const infoLinks = info ? [...new Set([...shown.urls.map(url => instagramPostLink(url)?.url ?? url), ...info.links])] : [];
  const infoPlace = !info ? null : mapped.url ? { url: mapped.url, label: mapped.label }
    : info.place ? { url: postLocationUrl(info.place, CITIES.find(city => city.id === post.cityId)?.englishName), label: info.place } : null;
  const slideCount = feed && !hidePhoto ? Math.max(post.imagePaths?.length ?? 0, post.imageUris?.length ?? 0) : 0;
  const slides = Array.from({ length: slideCount }, (_, index) => getPostImageSource(post, viewerScope, 'feed', index))
    .filter((source): source is NonNullable<typeof source> => !!source && !failedSlides.includes(source.uri));
  const slideKey = `${viewerScope}:${post.id}:${slides[0]?.uri}`;
  const firstRatio = loadedPhoto?.key === slideKey ? loadedPhoto.aspectRatio : null;
  // The list pads cards by Spacing.three; the photo row runs to the list edges and starts under the text column, the next photo peeking in.
  const slideWidth = Math.max(0, (photoRowWidth || Math.min(windowWidth, MaxContentWidth)) - FEED_PHOTO_INSET - Spacing.three - (slides.length > 1 ? FEED_PEEK : 0));
  // One photo keeps its own shape; a row of them shares the first one's, kept between 4:5 and 16:9, and each photo fills it,
  // edges cropped (owner 2026-11-03 "꽉 채우기"). The post detail still shows every photo whole.
  const slideRatio = slides.length > 1 ? Math.min(16 / 9, Math.max(4 / 5, firstRatio ?? 4 / 5)) : firstRatio ?? 16 / 10;
  const creditNames = feed ? photoCreditNames(credited.credits) : [];
  const photoCredit = !credited.credits ? '' : creditNames.length > 1 ? tr('사진: {0} 외 {1}명', creditNames[0], creditNames.length - 1)
    : creditNames.length ? tr('사진: {0}', creditNames[0]) : tr('사진 출처');
  const feedText = splitPostPhotoCredits(shown.body).body;
  const textKey = `${translation.display.title}\n${feedText}`;
  const textLong = textLines?.text === textKey && textLines.lines > 3;
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
  // 오늘 카드 ··· 의 내 글 고치기·삭제는 글 상세와 같은 수정 화면·삭제를 쓴다 (owner 2026-11-04).
  const editPost = () => { handOffPost(me.id, post); router.push({ pathname: '/post/[id]', params: { id: post.id, edit: '1' } }); };
  const removePost = async () => {
    try {
      await deletePost(supabase, post.id);
      play('warning');
      DeviceEventEmitter.emit(POST_CHANGED_EVENT, { id: post.id, removed: true } satisfies PostChange);
    } catch { play('warning'); Alert.alert(tr('글을 삭제하지 못했어요.'), t.detail.sendErrorBody); }
  };
  // 이 글 숨기기 (owner 2026-11-04): every list on screen drops it at once and no report is filed. The app has no undo toast,
  // so the existing alert carries 되돌리기, shown once the server has saved it. A failed save or undo puts the list back.
  const hidePost = async (hidden = true) => {
    if (!isAuthed) return promptLogin(tr('글을 숨기려면 로그인이 필요해요'));
    try {
      await setPostHidden(supabase, me.id, post.id, hidden);
      if (hidden) Alert.alert(tr('글을 숨겼어요'), tr('이제 내 화면에 이 글이 안 보여요.'), [
        { text: tr('되돌리기'), onPress: () => { play('selection'); void hidePost(false); } },
        { text: tr('확인'), onPress: () => play('selection') },
      ]);
    } catch { play('warning'); Alert.alert(tr(hidden ? '글을 숨기지 못했어요.' : '되돌리지 못했어요.'), t.detail.sendErrorBody); }
  };

  const roomModule = post.room && !hideRoom && (
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
          style={({ pressed }) => [styles.join, clay && { overflow: 'visible' }, { backgroundColor: clay ? 'transparent' : joinStatus ? theme.backgroundSelected : theme.accent }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={joinLabel}>
          {clay && <ClayPillFill kind={joinStatus ? 'white' : 'cta'} />}
          <ThemedText type="smallBold" style={{ color: joinStatus ? theme.text : theme.accentInk }}>
            {joinLabel}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
  const sheets = <>
    {/* 남의 글(운영 캐릭터·비즈니스 글 포함)은 이 글 숨기기 → 신고. 피드 카드와 글 상세의 ··· 가 같은 메뉴다 (QA B9-1). */}
    {menuOpen && <MeetupManageSheet visible title={tr('글 메뉴')} onClose={() => setMenuOpen(false)} actions={mine ? [
      { key: 'edit', analyticsId: 'components_post-detail.pressable.14', label: tr(post.room ? '소개·사진 수정' : '글·사진 수정'), onPress: editPost,
        icon: { ios: 'pencil', android: 'edit', web: 'edit' } },
      { key: 'delete', analyticsId: 'post.manage.delete', label: tr('글 삭제'), danger: true, onPress: () => setDeleteOpen(true),
        icon: { ios: 'trash', android: 'delete', web: 'delete' } },
    ] : [{ key: 'hide', analyticsId: 'post.manage.hide', label: tr('이 글 숨기기'), hint: tr('내 화면에서만 사라지고, 신고는 가지 않아요.'), onPress: () => void hidePost(),
      icon: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' } },
    { key: 'report', analyticsId: 'components_post-card.pressable.5', label: t.report.title(post.business?.name ?? post.author.nickname), danger: true,
      icon: { ios: 'flag', android: 'flag', web: 'flag' }, onPress: () => { if (isAuthed) setReportOpen(true); else promptLogin(t.auth.reasonReport); } }]} />}
    {deleteOpen && <MeetupManageSheet visible title={tr('이 글을 삭제할까요?')} onClose={() => setDeleteOpen(false)} actions={[
      { key: 'delete-confirm', analyticsId: 'components_post-detail.pressable.15', label: tr('글 삭제'), hint: tr('삭제한 글은 되돌릴 수 없어요. 달린 댓글도 함께 보이지 않게 됩니다.'), danger: true,
        icon: { ios: 'trash', android: 'delete', web: 'delete' }, onPress: () => void removePost() },
    ]} />}
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
  </>;

  // 본문 첫 줄(옛 앱도 읽는 요약)이 이미 가격을 말하면 카드 아래에서 또 쓰지 않는다(QA B8-2).
  const price = post.listingDetails?.lead && post.body.startsWith(post.listingDetails.lead) ? null : post.price;
  const listingLine = isListing && !beforeBody && (price != null || (post.listingStatus && post.listingStatus !== 'open')) && (
    <View style={styles.listingLine}>
      {price != null && <ThemedText style={styles.price}>{t.detail.price(price)}</ThemedText>}
      {post.listingStatus && post.listingStatus !== 'open' && (
        <ThemedText type="small" themeColor="textSecondary">{t.detail.listingStatus[post.listingStatus]}</ThemedText>
      )}
    </View>
  );

  if (feed && !meetupDetail && !postDetail) {
    const name = post.business?.name ?? post.author.nickname;
    const kind = post.business ? tr('비즈니스') : post.room ? tr('모임 호스트') : `${tr(post.tag.label)}${isListing ? ` · ${listingKind}` : ''}`;
    const time = `${post.createdAt ? relativeTime(post.createdAt, undefined, appLocale) : post.createdAtLabel ?? ''}${post.bumpedAt ? ` · ${t.detail.bumpedLabel}` : ''}`;
    const title = translation.display.title ?? post.title;
    const logo = post.business?.avatarUri && failedBusinessLogo !== post.business.avatarUri ? post.business.avatarUri : null;
    const openAuthor = () => { play('reaction'); onAuthor?.(); };
    // A hidden copy without the line limit counts lines, so 더 보기 shows only when the text is cut. Web cannot measure lines and keeps the plain limit.
    const text = (lead?: string) => <View>
      <PostBody lead={lead} body={withPostAttachments(feedText, shown.urls)} themeColor="text" numberOfLines={textOpen ? undefined : 3} linksEnabled={!onPress} />
      {!textOpen && Platform.OS !== 'web' && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.measure}>
        <PostBody lead={lead} body={feedText} themeColor="text" linksEnabled={false}
          onTextLayout={({ nativeEvent: { lines } }) => { if (textLines?.text !== textKey || textLines.lines !== lines.length) setTextLines({ text: textKey, lines: lines.length }); }} />
      </View>}
    </View>;
    return (
      // One native root for the zoom link, as below.
      <View collapsable={false} style={styles.feedCard}>
        <View style={styles.feedGrid}>
          {/* The nickname beside it is the screen-reader control for the same profile. */}
          <Pressable analyticsId="components_post-card.pressable.4" onPress={openAuthor} disabled={!onAuthor} hitSlop={2}
            accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.feedAvatar, { backgroundColor: clay && !logo ? 'transparent' : theme.backgroundSelected }, clay && !logo && styles.clayAvatar]}>
            {clay && !logo && !authorPhoto && <ClayCoinFill />}
            {logo ? <Image source={{ uri: logo }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors onError={() => setFailedBusinessLogo(logo)} />
              : authorPhoto ? <ClayPhoto uri={authorPhoto} size={FEED_AVATAR} onError={() => setFailedBusinessLogo(authorPhoto)} />
              : <ThemedText type="menu" style={{ color: theme.accent }}>{[...name][0]}</ThemedText>}
          </Pressable>
          <View style={styles.feedMain}>
            <View style={styles.feedHead}>
              <View style={styles.feedMeta}>
                <Pressable analyticsId="components_post-card.pressable.4" onPress={openAuthor} disabled={!onAuthor}
                  accessibilityRole={onAuthor ? 'button' : undefined} style={styles.feedAuthor}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.nickname}>{name}</ThemedText>
                  {!post.business && !post.room && <TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} />}
                </Pressable>
                <ThemedText type="small" themeColor="textSecondary">{[kind, time].filter(Boolean).map(part => `· ${part}`).join(' ')}</ThemedText>
                <PostAdLabel hashtags={post.hashtags} />
                {mine && <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.feed.mineBadge}</ThemedText>}
              </View>
              <Pressable analyticsId="post.manage.open" accessibilityRole="button" accessibilityLabel={tr('글 메뉴')}
                onPress={() => { play('selection'); setMenuOpen(true); }} style={[ControlStyles.icon, styles.feedMore]}>
                <ClayIcon clay="more" claySize={26} name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
            {proxied.proxy && <ThemedText type="small" themeColor="textSecondary">{tr('글링이 비즈니스 허락을 받고 대신 올렸어요')}</ThemedText>}
            <Pressable analyticsId="components_post-card.pressable.2" onPress={openPost} disabled={!onPress}
              accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? `${tr(post.tag.label)} · ${title}` : undefined}
              style={slides.length ? undefined : [styles.textOnly, { backgroundColor: clayBox ? 'transparent' : theme.backgroundElement }]}>
              {clayBox && !slides.length && <ClayBoxFill kind="text" />}
              {slides.length ? text(title) : <>
                <ThemedText type="menu">{title}</ThemedText>
                {!!feedText && text()}
              </>}
            </Pressable>
            {textLong && !textOpen && <Pressable analyticsId="components_post-card.pressable.1" accessibilityRole="button" accessibilityState={{ expanded: false }}
              onPress={() => { play('selection'); setTextOpen(true); }} style={styles.moreText}>
              <ThemedText type="smallBold" themeColor="textSecondary">{tr('더 보기')}</ThemedText>
            </Pressable>}
            {listingLine}
            <TranslationControl translation={translation} />
            {linkedPlace ? <PostPlaceCard place={linkedPlace} /> : !!mapped.url && <PostMapLink url={mapped.url} label={mapped.label} />}
            {afterBody}
            {roomModule}
          </View>
        </View>
        {slides.length > 0 && <ScrollView analyticsId="components_post-photo-gallery.scrollview.1" horizontal scrollEnabled={slides.length > 1} showsHorizontalScrollIndicator={false}
          decelerationRate="fast" snapToInterval={slideWidth + Spacing.two} snapToAlignment="start" disableIntervalMomentum
          onLayout={({ nativeEvent: { layout } }) => setPhotoRowWidth(layout.width)}
          onScroll={({ nativeEvent: { contentOffset } }) => setPhotoPage(Math.round(contentOffset.x / (slideWidth + Spacing.two)))} scrollEventThrottle={100}
          accessibilityLabel={tr('사진 {0}장', slides.length)} style={styles.feedPhotos} contentContainerStyle={styles.feedPhotoRow}>
          {slides.map((source, index) => <Pressable key={`${viewerScope}:${post.id}:${index}`} analyticsId="components_post-card.pressable.2" onPress={openPost} disabled={!onPress}
            accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={[tr('사진 {0}/{1}', index + 1, slides.length), title, photoCredit].filter(Boolean).join(' · ')}
            style={[styles.slide, { width: slideWidth, aspectRatio: slideRatio, backgroundColor: theme.backgroundElement }]}>
            {/* Only the photos next to the one in view load, as in the detail gallery. */}
            <Image source={Math.abs(index - photoPage) <= 1 ? source : null} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk"
              recyclingKey={`${viewerScope}:${post.id}:${index}`} transition={0}
              onLoad={index ? undefined : ({ source: { width, height } }) => {
                if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) setLoadedPhoto({ key: slideKey, aspectRatio: width / height });
              }}
              onError={() => setFailedSlides(previous => [...previous, source.uri])} />
            {slides.length > 1 && <View pointerEvents="none" style={[styles.photoBadge, styles.slideIndex]}>
              <ThemedText type="caption" style={styles.photoBadgeText}>{`${index + 1}/${slides.length}`}</ThemedText>
            </View>}
            {!!photoCredit && <View pointerEvents="none" style={[styles.photoBadge, styles.slideCredit, { maxWidth: slideWidth - 20 }]}>
              <ThemedText type="caption" numberOfLines={1} style={styles.photoBadgeText}>{photoCredit}</ThemedText>
            </View>}
          </Pressable>)}
        </ScrollView>}
        <View style={styles.feedActs}>
          <Pressable analyticsId="components_post-card.pressable.7" onPress={toggleLike} disabled={!!busyReaction} accessibilityRole="button" accessibilityLabel={t.feed.likes(likeCount)}
            accessibilityState={{ selected: likedOn, disabled: !!busyReaction, busy: busyReaction === 'like' }} style={styles.feedAct}>
            <ClayIcon clay={likedOn ? 'heart_on' : 'heart'} claySize={26} name={{ ios: likedOn ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' }} size={IconSize.toolbar} tintColor={likedOn ? theme.accent : theme.textSecondary} />
            <ThemedText type={likedOn ? 'smallBold' : 'small'} style={[styles.footItem, { color: likedOn ? theme.accent : theme.textSecondary }]}>{count(likeCount)}</ThemedText>
          </Pressable>
          <Pressable analyticsId="components_post-card.pressable.8" onPress={openPost} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={t.feed.comments(post.comments)} style={styles.feedAct}>
            <ClayIcon clay="bubble" claySize={26} name={{ ios: 'bubble.right', android: 'chat_bubble', web: 'chat_bubble' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>{count(post.comments)}</ThemedText>
          </Pressable>
          <Pressable analyticsId="components_post-card.pressable.10" onPress={() => void share()} accessibilityRole="button"
            accessibilityLabel={tr("{0} · {1}", (tr(post.room ? '모임 초대 링크 공유' : '게시물 링크 공유')), (t.feed.shares(shareCount)))} style={styles.feedAct}>
            <ClayIcon clay="share" claySize={26} name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
          </Pressable>
          {/* Owner 2026-11-09 "조회수 넣어": the Today card shows views again; a count, not a button. */}
          <View style={[styles.feedAct, styles.feedViews]} accessible accessibilityLabel={t.feed.views(post.views)}>
            <ClayIcon clay="eye" claySize={26} name={{ ios: 'eye', android: 'visibility', web: 'visibility' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={[styles.footItem, styles.feedViewsCount]}>{count(post.views)}</ThemedText>
          </View>
          <Pressable analyticsId="components_post-card.pressable.9" onPress={() => void toggleSave()} disabled={!!busyReaction} accessibilityRole="button" accessibilityLabel={savedOn ? tr('저장 취소') : tr('저장')}
            accessibilityState={{ selected: savedOn, disabled: !!busyReaction, busy: busyReaction === 'save' }} style={[styles.feedAct, styles.feedSave]}>
            <ClayIcon clay={savedOn ? 'bookmark_on' : 'bookmark'} claySize={26} name={{ ios: savedOn ? 'bookmark.fill' : 'bookmark', android: savedOn ? 'bookmark_added' : 'bookmark', web: savedOn ? 'bookmark_added' : 'bookmark' }} size={IconSize.toolbar} tintColor={savedOn ? theme.accent : theme.textSecondary} />
          </Pressable>
        </View>
        {sheets}
      </View>
    );
  }

  return (
    // collapsable={false}: a flat card's root is layout-only, and Fabric would flatten it away inside PostZoomLink,
    // whose zoom source keeps only its first native child (the author row) and drops the rest of the card.
    <View
      collapsable={false}
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
            <View style={[styles.avatar, (clay || authorPhoto) && !cardLogo && styles.clayCardAvatar, { backgroundColor: clay && !cardLogo ? 'transparent' : mine ? theme.accent : theme.backgroundElement }]}>
              {clay && !cardLogo && !authorPhoto && <ClayCoinFill me={mine} />}
              {authorPhoto ? <ClayPhoto uri={authorPhoto} size={32} onError={() => setFailedBusinessLogo(authorPhoto)} /> : post.business?.avatarUri && failedBusinessLogo !== post.business.avatarUri ? <Image
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
              {proxied.proxy && <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>{tr('글링이 비즈니스 허락을 받고 대신 올렸어요')}</ThemedText>}
            </View>
          </Pressable>
          {!mine && (
            <Pressable lens analyticsId="components_post-card.pressable.5"
              onPress={() => { play('selection'); setMenuOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel={tr('글 메뉴')}
              style={({ pressed }) => [styles.more, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent', transform: [{ scale: pressed ? 0.88 : 1 }] }]}>
              <ClayIcon
                clay="more"
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={22}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          )}
        </View>}

        {/* No onPress (post and meetup detail): RN would read disabled as "dimmed", so it is plain text whose lines and links are read one by one. */}
        <Pressable analyticsId="components_post-card.pressable.2"
          onPress={openPost}
          disabled={!onPress}
          accessible={!!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? `${tr(post.tag.label)} · ${translation.display.title}` : undefined}
          style={({ pressed }) => pressed && styles.pressed}>
          {meetupDetail ? meetupDetail.beforeTitle : <ThemedText
            type="smallBold"
            style={[styles.category, { color: isMeetup ? theme.accent : theme.textSecondary }]}>
            {tr(post.tag.label)}{isListing ? ` · ${listingKind}` : ''}
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
          {info && (info.rating != null || info.facts.length > 0) && <View style={styles.info}>
            {info.rating != null && <View accessible accessibilityLabel={tr('글링 평점 {0} / 10', info.rating.toFixed(1))} style={[styles.rating, { backgroundColor: theme.card }]}>
              <ThemedText style={styles.ratingScore}>{info.rating.toFixed(1)}<ThemedText themeColor="textSecondary" style={Typography.label}> / 10</ThemedText></ThemedText>
              <View style={[styles.ratingBar, { backgroundColor: theme.backgroundElement }]}><View style={[styles.ratingFill, { width: `${Math.min(100, info.rating * 10)}%`, backgroundColor: theme.accent }]} /></View>
              <ThemedText type="smallBold" themeColor="accent">{tr('글링 평점')}</ThemedText>
            </View>}
            {info.facts.length > 0 && <View style={[styles.facts, { borderColor: theme.line }]}>
              {info.facts.map((fact, index) => <View key={fact.label} style={[styles.fact, index > 0 && { borderLeftWidth: 1, borderLeftColor: theme.line }]}>
                <ThemedText type="small" themeColor="textSecondary">{tr(fact.label)}</ThemedText>
                <ThemedText style={styles.factValue}>{fact.value}</ThemedText>
              </View>)}
            </View>}
          </View>}
          {info && (infoPlace?.url || infoLinks.length > 0) && <View style={styles.info}>
            {infoPlace?.url && (linkedPlace ? <PostPlaceCard place={linkedPlace} /> : <PostMapLink url={infoPlace.url} label={infoPlace.label} />)}
            {infoLinks.length > 0 && <View style={[styles.infoLinks, { borderColor: theme.line }]}>
              {infoLinks.map((url, index) => <View key={url} style={index > 0 && [styles.infoDivider, { borderTopColor: theme.line }]}><PostAttachmentLink url={url} row /></View>)}
            </View>}
          </View>}
          {beforeBody}
          {!meetupDetail && (info ? <View style={styles.detailBodyWrap}>{bodyText}</View> : bodyText)}
          {listingLine}
        </Pressable>
        {meetupDetail && <>
          {meetupDetail.afterTitle}
          <View style={[styles.intro, { borderTopColor: theme.line }]}>
            <ThemedText accessibilityRole="header" style={Typography.section}>{tr('소개')}</ThemedText>
            {meetupSections ? <>
              {!!meetupSections.intro && <PostBody themeColor="text" style={[styles.body, post.room && flat && styles.meetupBody]} linksEnabled={!onPress} body={withPostAttachments(meetupSections.intro, shown.urls)} />}
              <MeetupSectionsView sections={meetupSections} />
            </> : bodyText}
            {!meetupSections && introLong && <Pressable analyticsId="meetup.detail.intro-more" accessibilityRole="button" accessibilityState={{ expanded: introOpen }}
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
                accessible={!!onHashtag}
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

        {roomModule}

        {!meetupDetail && !postDetail && <View style={[styles.foot, flat && styles.flatFoot, { borderTopColor: theme.line }]}>
          <Pressable lens analyticsId="components_post-card.pressable.7"
            onPress={toggleLike}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.likes(likeCount)}
            accessibilityState={{ selected: likedOn, disabled: !!busyReaction, busy: busyReaction === 'like' }}>
            <ClayIcon
              clay={likedOn ? 'heart_on' : 'heart'}
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
            <ClayIcon
              clay="bubble"
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
              <ClayIcon
                clay={savedOn ? 'bookmark_on' : 'bookmark'}
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
            <ClayIcon
              clay="share"
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
      {sheets}
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
    <ClayIcon clay={like ? (on ? 'heart_on' : 'heart') : (on ? 'bookmark_on' : 'bookmark')} name={icon} size={21} tintColor={on ? theme.accent : theme.text} />
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
  rating: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  ratingScore: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6 },
  ratingBar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  ratingFill: { height: '100%' },
  facts: { flexDirection: 'row', borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  fact: { flex: 1, padding: 12, gap: 2 },
  factValue: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
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
  feedCard: { paddingTop: Spacing.one },
  feedGrid: { flexDirection: 'row', gap: FEED_TEXT_INSET - FEED_AVATAR },
  clayAvatar: { overflow: 'visible' },
  clayCardAvatar: { width: 32, height: 32, padding: 0 },
  feedAvatar: { width: FEED_AVATAR, height: FEED_AVATAR, borderRadius: FEED_AVATAR / 2, marginTop: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  feedMain: { flex: 1, minWidth: 0 },
  feedHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  feedMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.one },
  feedAuthor: { flexShrink: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  feedMore: { marginRight: -12 },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  textOnly: { marginTop: Spacing.one, borderRadius: 20, paddingHorizontal: Spacing.three, paddingVertical: 14, gap: Spacing.one },
  moreText: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: -8, marginBottom: -14 },
  feedPhotos: { marginTop: 12, marginHorizontal: -Spacing.three },
  feedPhotoRow: { paddingLeft: FEED_PHOTO_INSET, paddingRight: Spacing.three, gap: Spacing.two },
  slide: { borderRadius: 12, overflow: 'hidden' },
  photoBadge: { position: 'absolute', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(22,22,24,0.66)' },
  slideIndex: { top: 10, right: 10 },
  slideCredit: { left: 10, bottom: 10 },
  photoBadgeText: { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  feedActs: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: FEED_TEXT_INSET - 8, paddingTop: 6 },
  feedAct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 44, minHeight: 44, paddingHorizontal: 8, borderRadius: 999 },
  feedSave: { marginLeft: 'auto' },
  // On a narrow screen with large text the count gives way first, so save never leaves the row.
  // Not a touch target, so it may go below 44pt; overflow keeps a squeezed count from drawing over save.
  feedViews: { flexShrink: 1, minWidth: 0, overflow: 'hidden', borderRadius: 0 },
  feedViewsCount: { flexShrink: 1 },
});

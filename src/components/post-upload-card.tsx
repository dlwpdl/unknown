import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { RaisedActionButton } from '@/components/raised-action-button';
import { PopIn } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { IconSize } from '@/constants/design-system';
import { Depth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  canRetryUpload, clearPostUpload, finishDelay, getPostUpload, retryPostUpload, subscribePostUpload, uploadBarSteps, UploadMotion,
  type PostUpload,
} from '@/lib/post-upload';

// 사장님 컨펌 2026-11-04 ③: 글쓰기 창이 닫히면 위에서 카드가 내려와 막대가 차고, 고른 사진 세 장이 카드로 날아가 쌓인다.
// 값은 output/reviews/upload-motion-2026-11-04/index.html 시안 그대로. 동작 줄이기면 날지 않고 카드와 막대만 나타난다.
const GUTTER = 12, MAX_WIDTH = 480, PAD_X = 14, PAD_TOP = 12, BORDER = 1, THUMB = 44, TILE = 34;
// 사진 i가 앉는 자리 [왼쪽, 위, 기울기]: 첫 사진이 맨 위.
const SPOTS = [[5, 7, 0], [1, 5, -8], [8, 3, 9]] as const;
const slideIn = Easing.bezier(0.2, 0.9, 0.25, 1), slideOut = Easing.bezier(0.5, 0, 0.75, 0);
const barOut = Easing.bezier(0.2, 0.7, 0.3, 1), flyCurve = Easing.bezier(0.3, 0.7, 0.2, 1);

/** 올리는 글 하나를 앱 맨 위에 보여 준다. 아이폰에서는 닫히는 글쓰기 창보다 위에 떠야 사진이 창 밖으로 날아가 보인다. */
export function PostUploadCard() {
  const upload = useSyncExternalStore(subscribePostUpload, getPostUpload, getPostUpload);
  const { me } = useAuth();
  const mine = !!upload && upload.owner === me.id;
  // 계정이 바뀌면 앞 사람의 글과 사진을 보여 주거나 다시 보내지 않는다.
  useEffect(() => { if (upload && !mine) clearPostUpload(upload.key); }, [upload, mine]);
  if (!upload || !mine) return null;
  const layer = <View pointerEvents="box-none" style={StyleSheet.absoluteFill}><UploadCard key={upload.key} upload={upload} /></View>;
  return Platform.OS === 'ios' ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{layer}</FullWindowOverlay> : layer;
}

function UploadCard({ upload }: { upload: PostUpload }) {
  const { tr, t } = useLanguage();
  const theme = useTheme(), insets = useSafeAreaInsets(), router = useRouter();
  const { width: screen } = useWindowDimensions();
  const { play } = useInteractionFeedback();
  const reduced = useReducedMotion();
  // 날아갈 사진의 순서(0이 첫 사진). 다시 보낼 때는 사진이 이미 카드에 있어 비어 있다.
  const flying = reduced ? [] : upload.photos.flatMap(({ from }, index) => from ? [index] : []);
  const [landed, setLanded] = useState(flying.length === 0);
  const [finished, setFinished] = useState(false);
  const [barWidth, setBarWidth] = useState(screen);
  const [enter] = useState(() => new Animated.Value(0)), [fade] = useState(() => new Animated.Value(0));
  const [progress] = useState(() => new Animated.Value(0)), [sheen] = useState(() => new Animated.Value(0));
  const [flight] = useState(() => flying.map(() => new Animated.Value(0)));
  const [rest] = useState(() => Animated.subtract(1, progress));

  const width = Math.min(screen - GUTTER * 2, MAX_WIDTH), left = (screen - width) / 2, top = insets.top + Spacing.one;
  const hidden = -(top + 120);
  const phase = upload.status === 'failed' ? 'failed' : finished ? 'done' : 'up';
  const photos = upload.photoCount > 0;
  const line = phase === 'up' ? photos ? tr('사진 {0}장 올리는 중', upload.photoCount) : tr('글 올리는 중')
    : phase === 'done' ? photos ? tr('사진을 올렸어요') : tr('글을 올렸어요')
    : photos ? tr('사진을 올리지 못했어요') : t.write.submitErrorTitle;
  const detail = phase === 'failed' ? photos ? tr('쓴 글과 사진은 그대로 있어요') : tr('쓴 글은 그대로 있어요') : phase === 'done' && upload.notice ? upload.notice : upload.title;
  const retryable = upload.status === 'failed' && canRetryUpload(upload.error);

  useEffect(() => {
    const appear = reduced
      ? Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.linear, useNativeDriver: true })
      : Animated.parallel([
          Animated.timing(enter, { toValue: 1, duration: 480, easing: slideIn, useNativeDriver: true }),
          Animated.timing(fade, { toValue: 1, duration: 140, easing: Easing.linear, useNativeDriver: true }),
        ]);
    appear.start();
    if (!flight.length) return () => appear.stop();
    const fly = Animated.stagger(UploadMotion.flyStaggerMs, flight.map(value => Animated.timing(value, { toValue: 1, duration: UploadMotion.flyMs, easing: flyCurve, useNativeDriver: true })));
    let timer: ReturnType<typeof setTimeout> | undefined;
    fly.start(() => { timer = setTimeout(() => setLanded(true), 40); });
    return () => { appear.stop(); fly.stop(); if (timer) clearTimeout(timer); };
  }, [enter, fade, flight, reduced]);

  // 막대: 올리는 중에는 70%·90%까지만, 서버 답이 오면 사진이 내려앉은 뒤 끝까지 찬다.
  useEffect(() => {
    if (upload.status === 'failed') { progress.stopAnimation(); return; }
    const run = (steps: ReturnType<typeof uploadBarSteps>) => Animated.sequence(steps.map(step => Animated.timing(progress, {
      toValue: step.to, duration: step.ms, easing: step.curve === 'out' ? barOut : Easing.linear, useNativeDriver: true })));
    if (upload.status === 'uploading') {
      progress.setValue(0);
      const animation = run(uploadBarSteps('uploading'));
      animation.start();
      return () => animation.stop();
    }
    const animation = Animated.sequence([Animated.delay(finishDelay(Date.now() - upload.startedAt)), run(uploadBarSteps('done'))]);
    animation.start(({ finished: ended }) => { if (ended) setFinished(true); });
    return () => animation.stop();
  }, [upload.status, upload.startedAt, progress]);

  useEffect(() => {
    if (reduced || upload.status !== 'uploading') return;
    sheen.setValue(0);
    const loop = Animated.loop(Animated.timing(sheen, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, sheen, upload.status]);

  // 다 올라간 순간 지금 앱의 글 올리기 소리·진동을 울리고, 1.5초 뒤 위로 빠져나간다. 내 첫 글이면 전면 3D 축하(사장님 2026-11-08).
  useEffect(() => { if (finished) play(upload.first ? 'postPublished' : 'postUploaded'); }, [finished, play, upload.first]);
  useEffect(() => {
    if (!finished) return;
    let leave: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(() => {
      leave = reduced
        ? Animated.timing(fade, { toValue: 0, duration: 180, easing: Easing.linear, useNativeDriver: true })
        : Animated.parallel([
            Animated.timing(enter, { toValue: 0, duration: 280, easing: slideOut, useNativeDriver: true }),
            Animated.timing(fade, { toValue: 0, duration: 160, delay: 120, easing: Easing.linear, useNativeDriver: true }),
          ]);
      leave.start(() => clearPostUpload(upload.key));
    }, upload.notice ? UploadMotion.holdMs * 2 : UploadMotion.holdMs); // 알림 한 줄은 읽을 시간을 더 준다
    return () => { clearTimeout(timer); leave?.stop(); };
  }, [finished, reduced, enter, fade, upload.key, upload.notice]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(phase === 'failed' || (phase === 'done' && upload.notice) ? `${line}. ${detail}` : line);
  }, [phase, line, detail, upload.notice]);

  const edit = () => {
    play('selection');
    clearPostUpload(upload.key);
    // 초안은 오늘 화면의 글쓰기에 그대로 있다. 그 화면이 compose=1을 받아 창을 연다.
    router.navigate('/?compose=1');
  };

  return <>
    <Animated.View pointerEvents={upload.status === 'failed' ? 'box-none' : 'none'}
      style={[styles.card, Depth.card, { top, left, width, backgroundColor: theme.card, borderColor: theme.line, opacity: fade,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : hidden, 0] }) }] }]}>
      <View accessible accessibilityLabel={`${line}, ${detail}`} style={styles.row}>
        <View style={styles.thumb}>
          {photos ? upload.photos.map((photo, index) => ({ photo, index })).reverse().map(({ photo, index }) => <Image key={index} source={{ uri: photo.uri }} contentFit="cover"
            style={[styles.tile, { left: SPOTS[index][0], top: SPOTS[index][1], borderColor: theme.card, transform: [{ rotate: `${SPOTS[index][2]}deg` }], opacity: landed ? 1 : 0 }]} />)
            : <View style={[styles.textThumb, { backgroundColor: theme.backgroundSelected }]}>
              <SymbolView name={{ ios: 'text.alignleft', android: 'notes', web: 'notes' }} size={IconSize.toolbar} tintColor={theme.accent} />
            </View>}
          {phase === 'done' && <PopIn style={[styles.mark, { backgroundColor: theme.accent, borderColor: theme.card }]}>
            <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.inline} tintColor={theme.accentInk} />
          </PopIn>}
          {phase === 'failed' && <View style={[styles.mark, { backgroundColor: theme.backgroundSelected, borderColor: theme.card }]}>
            <SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={IconSize.inline} tintColor={theme.accent} />
          </View>}
        </View>
        <Rise key={phase} reduced={reduced}>
          <ThemedText type="menu" numberOfLines={1}>{line}</ThemedText>
          <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={phase === 'done' && upload.notice ? 2 : 1}>{detail}</ThemedText>
        </Rise>
      </View>
      {upload.status === 'failed' ? <View style={styles.actions}>
        {retryable && <RaisedActionButton analyticsId="upload.retry" compact label={tr('다시 올리기')} onPress={() => { play('selection'); retryPostUpload(); }} />}
        <RaisedActionButton analyticsId="upload.edit" compact tone={retryable ? 'secondary' : 'primary'} label={tr('수정하기')} onPress={edit} />
      </View> : <View style={[styles.track, { backgroundColor: theme.backgroundElement }]} onLayout={event => setBarWidth(event.nativeEvent.layout.width)}>
        <View style={[StyleSheet.absoluteFill, { backgroundImage: `linear-gradient(90deg, ${theme.accentDepth}, ${theme.accent})` }]} />
        {!reduced && upload.status === 'uploading' && <Animated.View style={[StyleSheet.absoluteFill, styles.sheen,
          { transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-barWidth, barWidth] }) }] }]} />}
        {/* 안 찬 쪽을 바탕색으로 덮는다. 막대 자체를 늘리지 않아야 반짝임이 찌그러지지 않는다. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.rest, { backgroundColor: theme.backgroundElement, transform: [{ scaleX: rest }] }]} />
      </View>}
    </Animated.View>
    {!landed && upload.photos.map((photo, index) => {
      const value = flight[flying.indexOf(index)], from = photo.from;
      if (!value || !from) return null;
      const size = Math.max(from.width, from.height);
      const dx = left + BORDER + PAD_X + SPOTS[index][0] + TILE / 2 - (from.x + from.width / 2);
      const dy = top + BORDER + PAD_TOP + SPOTS[index][1] + TILE / 2 - (from.y + from.height / 2);
      const at = (to: number) => value.interpolate({ inputRange: [0, 1], outputRange: [0, to] });
      return <Animated.View key={index} pointerEvents="none" style={[styles.flying, { left: from.x, top: from.y, width: from.width, height: from.height, zIndex: 3 - index,
        transform: [{ translateX: at(dx) }, { translateY: at(dy) }, { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, TILE / size] }) },
          { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${SPOTS[index][2]}deg`] }) }] }]}>
        <Image source={{ uri: photo.uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
      </Animated.View>;
    })}
  </>;
}

/** 줄이 바뀔 때 새 글이 7pt 아래에서 올라오며 나타난다. */
function Rise({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: 1, duration: 260, easing: slideIn, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [value]);
  return <Animated.View style={[styles.text, { opacity: value.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 1, 1] }),
    transform: reduced ? [] : [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  card: { position: 'absolute', borderRadius: 20, borderWidth: BORDER, paddingTop: PAD_TOP, paddingHorizontal: PAD_X, paddingBottom: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: THUMB, height: THUMB },
  tile: { position: 'absolute', width: TILE, height: TILE, borderRadius: 9, borderWidth: 2 },
  textThumb: { width: THUMB, height: THUMB, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute', left: 8, top: 8, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  sheen: { backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' },
  rest: { transformOrigin: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  flying: { position: 'absolute', borderRadius: 10, overflow: 'hidden' },
});

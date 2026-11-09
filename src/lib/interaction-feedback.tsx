import { useLanguage } from '@/hooks/use-language';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type AudioPlayer, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { CLAY_CELEBRATION, CLAY_CONFETTI, useClay, useDark } from '@/components/clay';
import { SymbolView } from '@/components/symbol-view';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import {
  DEFAULT_INTERACTION_PREFERENCES,
  parseInteractionPreferences,
  type InteractionPreferences,
} from './interaction-feedback-preferences';

// meetup: a host handled a join request; meetupRequested: the member just sent one and still waits for the host.
// postUploaded: postPublished's sound and buzz without the full-screen celebration; the upload card at the top already says it.
type Celebration = 'meetupCreated' | 'postPublished' | 'verification2' | 'verification3' | 'membershipJoined' | 'firstMeetup' | 'inviteConnected';
type FeedbackKind = 'selection' | 'reaction' | 'message' | 'success' | 'meetup' | 'meetupRequested' | 'postUploaded' | 'warning' | Celebration;

// Full-screen moments, kept for rare ones (owner 2026-11-08 "컨펌 답 (3D 축하): 추천대로 28곳"). art: the clay drawing on the dark screen; glyph: the flat fallback (2D design, web).
const CELEBRATIONS: Record<Celebration, { art: keyof typeof CLAY_CELEBRATION; glyph: string; title: string; line: string; ms: number }> = {
  meetupCreated: { art: 'sparkle_d', glyph: '✦', title: '모임을 열었어요!', line: '이제 함께할 사람을 만날 차례예요.', ms: 1700 },
  postPublished: { art: 'megaphone_d', glyph: '✓', title: '첫 글을 올렸어요!', line: '오늘의 이야기가 동네에 닿았어요.', ms: 1700 },
  verification2: { art: 'seal_d', glyph: '✓', title: '인증 Lv{0} 달성!', line: '새로운 인증 단계가 프로필에 반영됐어요.', ms: 2300 },
  verification3: { art: 'seal_d', glyph: '✓', title: '인증 Lv{0} 달성!', line: '새로운 인증 단계가 프로필에 반영됐어요.', ms: 2300 },
  membershipJoined: { art: 'wordmark_d', glyph: '✦', title: '멤버십을 시작했어요!', line: '가입해 주셔서 고마워요. 혜택은 지금부터 쓸 수 있어요.', ms: 2300 },
  firstMeetup: { art: 'trophy_d', glyph: '✓', title: '첫 모임 다녀오셨네요!', line: '다음 모임도 마음 가는 대로 골라 보세요.', ms: 2300 },
  inviteConnected: { art: 'gift_d', glyph: '✓', title: '초대 코드가 들어갔어요!', line: '첫 모임에 다녀오면 초대한 분이 이용권을 받아요.', ms: 2300 },
};

type InteractionFeedbackValue = InteractionPreferences & {
  play: (kind: FeedbackKind) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

const STORAGE_KEY = 'gling.interaction-feedback';
const InteractionFeedbackContext = createContext<InteractionFeedbackValue | null>(null);
const CONFETTI = Array.from({ length: 24 }, (_, index) => {
  const angle = (index * Math.PI * 2) / 24;
  const distance = 105 + (index % 4) * 18;
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance + 48),
    rotate: `${index % 2 ? 210 : -190}deg`,
    color: (['#CBB9FF', '#F9C76C', '#F35CBB', '#83D9E7'] as const)[index % 4],
  };
});
// The kit files are 4–13dB louder than the old four sounds, so they play quieter rather than being edited: about the old loudness
// at the same moment (reaction·message ≈ -31, completions ≈ -25 LUFS), the frequent tap quietest, celebrations ~2dB above completions.
const VOLUME: Record<FeedbackKind, number> = {
  selection: 0.25, reaction: 0.35, message: 0.35, warning: 0.4,
  success: 0.65, meetupRequested: 0.65, meetup: 0.65, postUploaded: 0.65,
  meetupCreated: 0.6, postPublished: 0.6, verification2: 0.6, verification3: 0.6, membershipJoined: 0.6, firstMeetup: 0.6, inviteConnected: 0.6,
};
// A few clay pieces around the small ring's 3D badge, in its 124pt box.
const RING_CONFETTI = [[-4, 4, '#F9C76C', '-30deg'], [98, -2, '#F35CBB', '24deg'], [106, 72, '#83D9E7', '42deg'], [-8, 84, '#CBB9FF', '19deg'], [48, 108, '#F9C76C', '-18deg']] as const;

export function InteractionFeedbackProvider({ children }: { children: ReactNode }) {

  if (Platform.OS === 'web' && typeof window === 'undefined') {
    // Match the interactive root's child slots so hydration keeps useId links intact.
    return (
      <InteractionFeedbackContext.Provider value={{ ...DEFAULT_INTERACTION_PREFERENCES, play: () => {}, setSoundEnabled: () => {}, setHapticsEnabled: () => {} }}>
        <View style={styles.root}>{children}{null}{null}</View>
      </InteractionFeedbackContext.Provider>
    );
  }
  return <InteractiveFeedbackProvider>{children}</InteractiveFeedbackProvider>;
}

function InteractiveFeedbackProvider({ children }: { children: ReactNode }) {
  const { tr } = useLanguage();
  const [preferences, setPreferences] = useState(DEFAULT_INTERACTION_PREFERENCES);
  const [commit, setCommit] = useState<'success' | 'meetup' | 'meetupRequested' | null>(null);
  const [celebrating, setCelebrating] = useState<Celebration | null>(null);
  const reducedMotion = useReducedMotion();
  const clay = useClay(), dark = useDark();
  const [commitOpacity] = useState(() => new Animated.Value(0));
  const [commitScale] = useState(() => new Animated.Value(0.75));
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [celebrationBurst] = useState(() => new Animated.Value(0));
  const [celebrationScale] = useState(() => new Animated.Value(0.62));
  const [celebrationOpacity] = useState(() => new Animated.Value(1));
  // The owner's picks, one per moment (2026-11-08 "컨펌 답 (앱 효과음)", unknown/output/reviews/app-sounds-2026-11-08/kit).
  const selectionPlayer = useAudioPlayer(require('@/assets/sounds/selection-B1.wav'));
  const reactionPlayer = useAudioPlayer(require('@/assets/sounds/reaction-B1.wav'));
  const messagePlayer = useAudioPlayer(require('@/assets/sounds/message-B2.wav'));
  const warningPlayer = useAudioPlayer(require('@/assets/sounds/warning-B1.wav'));
  const successPlayer = useAudioPlayer(require('@/assets/sounds/success-B2.wav'));
  const requestedPlayer = useAudioPlayer(require('@/assets/sounds/meetupRequested-B1.wav'));
  const meetupPlayer = useAudioPlayer(require('@/assets/sounds/meetup-B1.wav'));
  const uploadedPlayer = useAudioPlayer(require('@/assets/sounds/postUploaded-B1.wav'));
  const createdPlayer = useAudioPlayer(require('@/assets/sounds/meetupCreated-B1.wav'));
  const publishedPlayer = useAudioPlayer(require('@/assets/sounds/postPublished-B2.wav'));
  const level2Player = useAudioPlayer(require('@/assets/sounds/verification2-B2.wav'));
  const level3Player = useAudioPlayer(require('@/assets/sounds/verification3-B2.wav'));

  useEffect(() => {
    // Never set before, so iOS used soloAmbient (stopped other apps' music) and Android played through silent/vibrate and took audio focus.
    // Now: quiet under the silent switch or ringer, and mixed over whatever else is playing.
    if (Platform.OS !== 'web') void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setPreferences(parseInteractionPreferences(value)))
      .catch(() => {});
    return () => { if (commitTimer.current) clearTimeout(commitTimer.current); };
  }, []);

  useEffect(() => {
    if (!celebrating) return;
    const hold = CELEBRATIONS[celebrating].ms;
    // Moving less shows a still picture: the confetti already part way out, nothing popping.
    celebrationBurst.setValue(reducedMotion ? 0.6 : 0);
    celebrationScale.setValue(reducedMotion ? 1 : 0.62);
    celebrationOpacity.setValue(1);
    const animation = reducedMotion
      ? Animated.sequence([
          Animated.delay(hold),
          Animated.timing(celebrationOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(celebrationBurst, { toValue: 1, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.sequence([
            Animated.spring(celebrationScale, { toValue: 1.08, damping: 8, stiffness: 210, mass: 0.8, useNativeDriver: true }),
            Animated.spring(celebrationScale, { toValue: 1, damping: 14, stiffness: 220, mass: 0.8, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(hold),
            Animated.timing(celebrationOpacity, { toValue: 0, duration: 430, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
        ]);
    animation.start(({ finished }) => { if (finished) setCelebrating(null); });
    return () => animation.stop();
  }, [celebrating, celebrationBurst, celebrationOpacity, celebrationScale, reducedMotion]);

  const updatePreference = useCallback((key: keyof InteractionPreferences, enabled: boolean) => {
    setPreferences((current) => {
      const next = { ...current, [key]: enabled };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const play = useCallback((kind: FeedbackKind) => {
    if (kind in CELEBRATIONS) setCelebrating(kind as Celebration);
    if (kind === 'success' || kind === 'meetup' || kind === 'meetupRequested') {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitOpacity.stopAnimation(); commitScale.stopAnimation();
      setCommit(kind);
      commitOpacity.setValue(1); commitScale.setValue(reducedMotion ? 1 : clay ? 0.6 : 0.75);
      if (reducedMotion) commitTimer.current = setTimeout(() => setCommit(null), 700);
      else Animated.parallel([
        // The clay badge pops past full size and settles, about 0.65s in all; the flat ring keeps growing as before.
        Animated.timing(commitScale, clay
          ? { toValue: 1, duration: 380, easing: Easing.out(Easing.back(2.4)), useNativeDriver: true }
          : { toValue: 1.28, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([Animated.delay(clay ? 300 : 260), Animated.timing(commitOpacity, { toValue: 0, duration: clay ? 340 : 360, useNativeDriver: true })]),
      ]).start(({ finished }) => { if (finished) setCommit(null); });
    }
    if (preferences.soundEnabled) {
      const player = ({
        selection: selectionPlayer, reaction: reactionPlayer, message: messagePlayer, warning: warningPlayer, success: successPlayer,
        meetupRequested: requestedPlayer, meetup: meetupPlayer, postUploaded: uploadedPlayer, meetupCreated: createdPlayer, postPublished: publishedPlayer,
        verification2: level2Player, verification3: level3Player,
        // Full-screen moments the sound board did not have share the post celebration's sound until they get their own.
        membershipJoined: publishedPlayer, firstMeetup: publishedPlayer, inviteConnected: publishedPlayer,
      } satisfies Record<FeedbackKind, AudioPlayer>)[kind];
      try {
        player.volume = VOLUME[kind];
        void player.seekTo(0).catch(() => {});
        player.play();
      } catch {
        // 피드백 실패가 사용자의 원래 작업을 막으면 안 된다.
      }
    }

    if (!preferences.hapticsEnabled) return;
    const haptic = kind === 'selection'
      ? Haptics.selectionAsync()
      : kind === 'reaction' || kind === 'message'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(
            kind === 'warning' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
          );
    void haptic.catch(() => {});
  }, [clay, commitOpacity, commitScale, createdPlayer, level2Player, level3Player, meetupPlayer, messagePlayer, preferences, publishedPlayer, reactionPlayer, reducedMotion, requestedPlayer, selectionPlayer, successPlayer, uploadedPlayer, warningPlayer]);

  const commitLabel = commit === 'meetup' ? tr("참여 신청을 처리했어요") : commit === 'meetupRequested' ? tr('신청을 보냈어요') : tr("완료했어요");
  const shown = celebrating ? CELEBRATIONS[celebrating] : null, verification = !!celebrating?.startsWith('verification');
  const title = shown ? tr(shown.title, celebrating!.slice(-1)) : '', line = shown ? tr(shown.line) : '';
  return (
    <InteractionFeedbackContext.Provider
      value={{
        ...preferences,
        play,
        setSoundEnabled: (enabled) => updatePreference('soundEnabled', enabled),
        setHapticsEnabled: (enabled) => updatePreference('hapticsEnabled', enabled),
      }}>
      <View style={styles.root}>
        {children}
        {commit && <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={commitLabel} style={[styles.commitOverlay, { opacity: commitOpacity, transform: [{ scale: commitScale }] }]}>
          {clay ? <View style={styles.commitStage}>
            {RING_CONFETTI.map(([left, top, color, rotate], index) => <Image key={index} accessible={false} source={CLAY_CONFETTI[color]} style={[styles.commitConfetti, { left, top, transform: [{ rotate }] }]} />)}
            <Image accessible={false} source={CLAY_CELEBRATION[commit === 'success' ? dark ? 'seal_d' : 'seal' : dark ? 'sparkle_d' : 'sparkle']} style={styles.commitArt} />
          </View> : <View style={styles.commitRing}>
            {[[5, -22, '#F9C76C', '-30deg'], [54, -38, '#F35CBB', '24deg'], [103, -14, '#83D9E7', '42deg'], [-25, 30, '#CBB9FF', '19deg'], [125, 39, '#F9C76C', '-18deg'], [-29, 89, '#F35CBB', '35deg'], [120, 101, '#83D9E7', '-40deg'], [20, 128, '#F9C76C', '28deg'], [76, 136, '#CBB9FF', '-22deg']].map(([left, top, color, rotate], index) => <View key={index} style={[styles.commitParticle, { left: left as number, top: top as number, backgroundColor: color as string, transform: [{ rotate: rotate as string }] }]} />)}
            <View style={styles.commitCore}><Text style={styles.commitGlyph}>{commit === 'success' ? '✓' : '✦'}</Text></View>
          </View>}
          <Text style={styles.commitLabel}>{commitLabel}</Text>
        </Animated.View>}
        <Modal visible={celebrating !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => setCelebrating(null)}>
          <Animated.View style={[styles.celebrationScreen, { opacity: celebrationOpacity }]}>
            <Pressable accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={`${title} ${line}`} accessibilityHint={tr('축하 화면 닫기')} onPress={() => setCelebrating(null)} style={styles.celebrationCenter}>
              <View style={styles.celebrationStage}>
                {CONFETTI.map((piece, index) => {
                  const motion = [styles.celebrationParticle, clay ? styles.clayParticle : { backgroundColor: piece.color }, {
                    opacity: celebrationBurst.interpolate({ inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 1, 0] }),
                    transform: [
                      { translateX: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: [0, piece.x] }) },
                      { translateY: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: [0, piece.y] }) },
                      { rotate: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', piece.rotate] }) },
                    ],
                  }];
                  return clay ? <Animated.Image key={index} pointerEvents="none" accessible={false} source={CLAY_CONFETTI[piece.color]} style={motion} /> : <Animated.View key={index} pointerEvents="none" style={motion} />;
                })}
                <Animated.View style={[!clay && styles.celebrationRing, !clay && verification && styles.verificationRing, { transform: [{ scale: celebrationScale }] }]}>
                  {clay && shown ? <Image accessible={false} source={CLAY_CELEBRATION[shown.art]} resizeMode="contain" style={shown.art === 'wordmark_d' ? styles.celebrationMark : styles.celebrationArt} />
                    : <View style={[styles.celebrationCore, verification && styles.verificationCore]}>{verification
                      ? <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} size={62} tintColor="#1A0E0B" />
                      : <Text style={styles.celebrationGlyph}>{shown?.glyph}</Text>}</View>}
                </Animated.View>
              </View>
              <Text style={styles.celebrationTitle}>{title}</Text>
              <Text style={styles.celebrationSubtitle}>{line}</Text>
            </Pressable>
          </Animated.View>
        </Modal>
      </View>
    </InteractionFeedbackContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  commitOverlay: { position: 'absolute', top: '33%', alignSelf: 'center', zIndex: 1000, alignItems: 'center', gap: 10 },
  commitRing: { width: 124, height: 124, borderRadius: 62, borderWidth: 2, borderColor: '#CBB9FF', backgroundColor: 'rgba(203,185,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  commitCore: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#CBB9FF', alignItems: 'center', justifyContent: 'center' },
  commitParticle: { position: 'absolute', width: 9, height: 18, borderRadius: 2 },
  commitGlyph: { color: '#171123', fontSize: 42, fontWeight: '700', lineHeight: 54 },
  commitStage: { width: 124, height: 124, alignItems: 'center', justifyContent: 'center' },
  commitArt: { width: 84, height: 84 },
  commitConfetti: { position: 'absolute', width: 24, height: 24 },
  commitLabel: { color: '#F6F3F0', backgroundColor: '#171722', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 7, fontSize: 14, fontWeight: '700', overflow: 'hidden' },
  celebrationScreen: { flex: 1, backgroundColor: 'rgba(11, 11, 18, 0.95)' },
  celebrationCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  celebrationStage: { width: 270, height: 270, alignItems: 'center', justifyContent: 'center' },
  celebrationParticle: { position: 'absolute', left: 129, top: 129, width: 10, height: 21, borderRadius: 2 },
  clayParticle: { left: 121, top: 121, width: 28, height: 28, borderRadius: 0 },
  celebrationArt: { width: 140, height: 140 },
  celebrationMark: { width: 240, height: 92 },
  celebrationRing: { width: 154, height: 154, borderRadius: 77, borderWidth: 2, borderColor: '#CBB9FF', backgroundColor: 'rgba(203,185,255,0.13)', alignItems: 'center', justifyContent: 'center', shadowColor: '#CBB9FF', shadowOpacity: 0.65, shadowRadius: 30 },
  verificationRing: { borderColor: '#E15A44', backgroundColor: 'rgba(225,90,68,0.15)', shadowColor: '#E15A44' },
  celebrationCore: { width: 112, height: 112, borderRadius: 56, backgroundColor: '#CBB9FF', alignItems: 'center', justifyContent: 'center' },
  verificationCore: { backgroundColor: '#E15A44' },
  celebrationGlyph: { color: '#171123', fontSize: 66, fontWeight: '700' },
  celebrationTitle: { color: '#F6F3F0', fontSize: 29, fontWeight: '800', letterSpacing: -1, textAlign: 'center', marginTop: 4 },
  celebrationSubtitle: { color: '#D2CBDB', fontSize: 15, textAlign: 'center', marginTop: 8 },
});

export function useInteractionFeedback() {
  const value = useContext(InteractionFeedbackContext);
  if (!value) throw new Error('InteractionFeedbackProvider is missing');
  return value;
}

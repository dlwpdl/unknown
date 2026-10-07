import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import {
  DEFAULT_INTERACTION_PREFERENCES,
  parseInteractionPreferences,
  type InteractionPreferences,
} from './interaction-feedback-preferences';

type FeedbackKind = 'selection' | 'reaction' | 'message' | 'success' | 'meetup' | 'meetupCreated' | 'postPublished' | 'verification2' | 'verification3' | 'warning';

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
    color: ['#CBB9FF', '#F9C76C', '#F35CBB', '#83D9E7'][index % 4],
  };
});

export function InteractionFeedbackProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_INTERACTION_PREFERENCES);
  const [commit, setCommit] = useState<'success' | 'meetup' | null>(null);
  const [celebrating, setCelebrating] = useState<'meetup' | 'post' | 'verification2' | 'verification3' | null>(null);
  const reducedMotion = useReducedMotion();
  const [commitOpacity] = useState(() => new Animated.Value(0));
  const [commitScale] = useState(() => new Animated.Value(0.75));
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [celebrationBurst] = useState(() => new Animated.Value(0));
  const [celebrationScale] = useState(() => new Animated.Value(0.62));
  const [celebrationOpacity] = useState(() => new Animated.Value(1));
  const reactionPlayer = useAudioPlayer(require('@/assets/sounds/reaction-pop.wav'));
  const messagePlayer = useAudioPlayer(require('@/assets/sounds/message-paper.wav'));
  const successPlayer = useAudioPlayer(require('@/assets/sounds/post-stamp.wav'));
  const meetupPlayer = useAudioPlayer(require('@/assets/sounds/meetup-knock.wav'));

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setPreferences(parseInteractionPreferences(value)))
      .catch(() => {});
    return () => { if (commitTimer.current) clearTimeout(commitTimer.current); };
  }, []);

  useEffect(() => {
    if (!celebrating) return;
    celebrationBurst.setValue(0);
    celebrationScale.setValue(reducedMotion ? 1 : 0.62);
    celebrationOpacity.setValue(1);
    const animation = reducedMotion
      ? Animated.sequence([
          Animated.delay(celebrating.startsWith('verification') ? 2300 : 1700),
          Animated.timing(celebrationOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(celebrationBurst, { toValue: 1, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.sequence([
            Animated.spring(celebrationScale, { toValue: 1.08, damping: 8, stiffness: 210, mass: 0.8, useNativeDriver: true }),
            Animated.spring(celebrationScale, { toValue: 1, damping: 14, stiffness: 220, mass: 0.8, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(celebrating.startsWith('verification') ? 2300 : 1700),
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
    if (kind === 'meetupCreated' || kind === 'postPublished' || kind === 'verification2' || kind === 'verification3') {
      setCelebrating(kind === 'meetupCreated' ? 'meetup' : kind === 'postPublished' ? 'post' : kind);
    }
    if (kind === 'success' || kind === 'meetup') {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitOpacity.stopAnimation(); commitScale.stopAnimation();
      setCommit(kind);
      commitOpacity.setValue(1); commitScale.setValue(reducedMotion ? 1 : 0.75);
      if (reducedMotion) commitTimer.current = setTimeout(() => setCommit(null), 700);
      else Animated.parallel([
        Animated.timing(commitScale, { toValue: 1.28, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([Animated.delay(260), Animated.timing(commitOpacity, { toValue: 0, duration: 360, useNativeDriver: true })]),
      ]).start(({ finished }) => { if (finished) setCommit(null); });
    }
    if (preferences.soundEnabled) {
      const player = kind === 'reaction'
        ? reactionPlayer
        : kind === 'message'
          ? messagePlayer
          : kind === 'success' || kind === 'postPublished' || kind === 'verification2' || kind === 'verification3'
            ? successPlayer
            : kind === 'meetup' || kind === 'meetupCreated'
              ? meetupPlayer
              : null;
      if (player) {
        try {
          void player.seekTo(0).catch(() => {});
          player.play();
        } catch {
          // 피드백 실패가 사용자의 원래 작업을 막으면 안 된다.
        }
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
  }, [commitOpacity, commitScale, meetupPlayer, messagePlayer, preferences, reactionPlayer, reducedMotion, successPlayer]);

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
        {commit && <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={commit === 'meetup' ? '모임을 열었어요' : '글을 올렸어요'} style={[styles.commitOverlay, { opacity: commitOpacity, transform: [{ scale: commitScale }] }]}>
          <View style={styles.commitRing}>
            {[[5, -22, '#F9C76C', '-30deg'], [54, -38, '#F35CBB', '24deg'], [103, -14, '#83D9E7', '42deg'], [-25, 30, '#CBB9FF', '19deg'], [125, 39, '#F9C76C', '-18deg'], [-29, 89, '#F35CBB', '35deg'], [120, 101, '#83D9E7', '-40deg'], [20, 128, '#F9C76C', '28deg'], [76, 136, '#CBB9FF', '-22deg']].map(([left, top, color, rotate], index) => <View key={index} style={[styles.commitParticle, { left: left as number, top: top as number, backgroundColor: color as string, transform: [{ rotate: rotate as string }] }]} />)}
            <View style={styles.commitCore}><Text style={styles.commitGlyph}>{commit === 'meetup' ? '✦' : '✓'}</Text></View>
          </View>
          <Text style={styles.commitLabel}>{commit === 'meetup' ? '모임을 열었어요' : '글을 올렸어요'}</Text>
        </Animated.View>}
        <Modal visible={celebrating !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => setCelebrating(null)}>
          <Animated.View style={[styles.celebrationScreen, { opacity: celebrationOpacity }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${celebrating?.startsWith('verification') ? `인증 레벨 ${celebrating.slice(-1)} 달성` : celebrating === 'meetup' ? '모임을 열었어요' : '글을 올렸어요'}. 축하 화면 닫기`} onPress={() => setCelebrating(null)} style={styles.celebrationCenter}>
              <View style={styles.celebrationStage}>
                {!reducedMotion && CONFETTI.map((piece, index) => <Animated.View key={index} pointerEvents="none" style={[styles.celebrationParticle, {
                  backgroundColor: piece.color,
                  opacity: celebrationBurst.interpolate({ inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [
                    { translateX: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: [0, piece.x] }) },
                    { translateY: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: [0, piece.y] }) },
                    { rotate: celebrationBurst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', piece.rotate] }) },
                  ],
                }]} />)}
                <Animated.View style={[styles.celebrationRing, celebrating?.startsWith('verification') && styles.verificationRing, { transform: [{ scale: celebrationScale }] }]}>
                  <View style={[styles.celebrationCore, celebrating?.startsWith('verification') && styles.verificationCore]}>{celebrating?.startsWith('verification')
                    ? <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} size={62} tintColor="#1A0E0B" />
                    : <Text style={styles.celebrationGlyph}>{celebrating === 'meetup' ? '✦' : '✓'}</Text>}</View>
                </Animated.View>
              </View>
              <Text style={styles.celebrationTitle}>{celebrating?.startsWith('verification') ? `인증 Lv${celebrating.slice(-1)} 달성!` : celebrating === 'meetup' ? '모임을 열었어요!' : '글을 올렸어요!'}</Text>
              <Text style={styles.celebrationSubtitle}>{celebrating?.startsWith('verification') ? '새로운 인증 단계가 프로필에 반영됐어요.' : celebrating === 'meetup' ? '이제 함께할 사람을 만날 차례예요.' : '오늘의 이야기가 동네에 닿았어요.'}</Text>
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
  commitLabel: { color: '#F6F3F0', backgroundColor: '#171722', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 7, fontSize: 14, fontWeight: '700', overflow: 'hidden' },
  celebrationScreen: { flex: 1, backgroundColor: 'rgba(11, 11, 18, 0.95)' },
  celebrationCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  celebrationStage: { width: 270, height: 270, alignItems: 'center', justifyContent: 'center' },
  celebrationParticle: { position: 'absolute', left: 129, top: 129, width: 10, height: 21, borderRadius: 2 },
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import {
  DEFAULT_INTERACTION_PREFERENCES,
  parseInteractionPreferences,
  type InteractionPreferences,
} from './interaction-feedback-preferences';

type FeedbackKind = 'selection' | 'reaction' | 'message' | 'success' | 'meetup' | 'warning';

type InteractionFeedbackValue = InteractionPreferences & {
  play: (kind: FeedbackKind) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

const STORAGE_KEY = 'gling.interaction-feedback';
const InteractionFeedbackContext = createContext<InteractionFeedbackValue | null>(null);

export function InteractionFeedbackProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_INTERACTION_PREFERENCES);
  const reactionPlayer = useAudioPlayer(require('@/assets/sounds/reaction-pop.wav'));
  const messagePlayer = useAudioPlayer(require('@/assets/sounds/message-paper.wav'));
  const successPlayer = useAudioPlayer(require('@/assets/sounds/post-stamp.wav'));
  const meetupPlayer = useAudioPlayer(require('@/assets/sounds/meetup-knock.wav'));

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setPreferences(parseInteractionPreferences(value)))
      .catch(() => {});
  }, []);

  const updatePreference = useCallback((key: keyof InteractionPreferences, enabled: boolean) => {
    setPreferences((current) => {
      const next = { ...current, [key]: enabled };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const play = useCallback((kind: FeedbackKind) => {
    if (preferences.soundEnabled) {
      const player = kind === 'reaction'
        ? reactionPlayer
        : kind === 'message'
          ? messagePlayer
          : kind === 'success'
            ? successPlayer
            : kind === 'meetup'
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
  }, [meetupPlayer, messagePlayer, preferences, reactionPlayer, successPlayer]);

  return (
    <InteractionFeedbackContext.Provider
      value={{
        ...preferences,
        play,
        setSoundEnabled: (enabled) => updatePreference('soundEnabled', enabled),
        setHapticsEnabled: (enabled) => updatePreference('hapticsEnabled', enabled),
      }}>
      {children}
    </InteractionFeedbackContext.Provider>
  );
}

export function useInteractionFeedback() {
  const value = useContext(InteractionFeedbackContext);
  if (!value) throw new Error('InteractionFeedbackProvider is missing');
  return value;
}

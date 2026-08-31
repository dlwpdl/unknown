export type InteractionPreferences = {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
};

export const DEFAULT_INTERACTION_PREFERENCES: InteractionPreferences = {
  soundEnabled: true,
  hapticsEnabled: true,
};

export function parseInteractionPreferences(value: string | null): InteractionPreferences {
  if (!value) return DEFAULT_INTERACTION_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<InteractionPreferences>;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
      hapticsEnabled: typeof parsed.hapticsEnabled === 'boolean' ? parsed.hapticsEnabled : true,
    };
  } catch {
    return DEFAULT_INTERACTION_PREFERENCES;
  }
}

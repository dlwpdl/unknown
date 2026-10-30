import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Platform } from 'react-native';

const KEY = 'gling.storeReview.lastAskedAt';
const GAP = 120 * 24 * 60 * 60 * 1000;

// Called only after a good moment (meetup check-in, a 4★+ meetup review). The OS also caps the sheet (iOS: 3 a year).
export async function askForStoreReview(now = Date.now(), storage = AsyncStorage, review = StoreReview, os = Platform.OS) {
  if (os === 'web') return false;
  try {
    const last = Number(await storage.getItem(KEY));
    if (last && now - last < GAP) return false;
    if (!(await review.isAvailableAsync())) return false;
    await storage.setItem(KEY, String(now));
    await review.requestReview();
    return true;
  } catch { return false; }
}

// Leaves a beat for the success notice before the system sheet appears.
export const askForStoreReviewSoon = () => { setTimeout(() => void askForStoreReview(), 1500); };

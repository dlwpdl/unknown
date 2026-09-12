import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';
export const pushConfigured = pushSupported && typeof projectId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

export async function pushPermissionGranted() {
  const status = await Notifications.getPermissionsAsync();
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function registerPushDevice(client: SupabaseClient, userId: string, requestPermission = false) {
  if (!pushConfigured) throw new Error('PUSH_NOT_CONFIGURED');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('gling-activity', {
    name: '글링 소식', importance: Notifications.AndroidImportance.DEFAULT,
  });
  if (!await pushPermissionGranted()) {
    if (!requestPermission) return false;
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return false;
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await client.rpc('register_push_device', { p_token: token, p_user_id: userId });
  if (error) throw error;
  return true;
}

export async function unregisterPushDevice(client: SupabaseClient, userId: string) {
  const { error } = await client.rpc('unregister_push_device', { p_token: null, p_user_id: userId });
  if (error) throw error;
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
}

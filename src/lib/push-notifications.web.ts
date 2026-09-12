import type { SupabaseClient } from '@supabase/supabase-js';

export const pushSupported = false;
export const pushConfigured = false;
export async function pushPermissionGranted() { return false; }
export async function registerPushDevice(_client: SupabaseClient, _userId: string, _requestPermission = false) { return false; }
export async function unregisterPushDevice(_client: SupabaseClient, _userId: string) {}

import type { SupabaseClient } from '@supabase/supabase-js';

// 공식 SNS 사진 소개 동의 (owner 2026-11-04 "G4 글쓰기·설정에 넣기"). Only a photo post whose author ticked the box can
// become an official Reel or carousel. create_post keeps its signature for older apps, so consent is a second call.
// on: the box's starting value. consentedPosts: live posts that still carry a yes (settings offers to withdraw them).
export type PhotoConsentSettings = { on: boolean; consentedPosts: number };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new Error('INVALID_PHOTO_CONSENT_RESPONSE'); }
function parse(value: unknown): PhotoConsentSettings {
  if (!object(value) || typeof value.photoConsentDefault !== 'boolean') invalid();
  const posts = value.consentedPosts;
  if (typeof posts !== 'number' || !Number.isInteger(posts) || posts < 0) invalid();
  return { on: value.photoConsentDefault, consentedPosts: posts };
}

/** null: the server has no consent calls yet (PGRST202), so the app hides the box and the setting. */
export async function loadPhotoConsentSettings(client: SupabaseClient): Promise<PhotoConsentSettings | null> {
  const { data, error } = await client.rpc('get_photo_consent_default');
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  return parse(data);
}

/** Off also withdraws every earlier yes on the server, so sending off again is how settings withdraws them. */
export async function setPhotoConsentDefault(client: SupabaseClient, on: boolean): Promise<PhotoConsentSettings> {
  const { data, error } = await client.rpc('set_photo_consent_default', { p_on: on });
  if (error) throw error;
  const saved = parse(data);
  if (saved.on !== on || (!on && saved.consentedPosts !== 0)) invalid();
  return saved;
}

/** After the post is up. Tries twice and never throws: false means the post stays up without consent and the caller says so. */
export async function savePostPhotoConsent(client: SupabaseClient, postId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await client.rpc('set_post_photo_consent', { p_post_id: postId, p_consent: true });
      if (!error && object(data) && data.consent === true) return true;
    } catch { /* try once more */ }
  }
  return false;
}

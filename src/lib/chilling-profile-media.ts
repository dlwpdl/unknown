import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_IMAGE_BYTES, estimatedBase64Bytes } from './image-upload.ts';
import type { PostDraftImage } from './community-data.ts';

const ownerId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const photoPath = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[a-z0-9-]+\.(?:jpg|png|webp)$/i;
const formats: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadMeetupProfilePhoto(client: SupabaseClient, userId: string, photo: PostDraftImage) {
  if (!ownerId.test(userId)) throw new Error('INVALID_MEETUP_PHOTO');
  const extension = formats[photo.mimeType];
  if (!extension) throw new Error('UNSUPPORTED_IMAGE_TYPE');
  if (estimatedBase64Bytes(photo.base64) > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  if (!photo.base64 || photo.base64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(photo.base64)) throw new Error('INVALID_MEETUP_PHOTO');
  const binary = atob(photo.base64);
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
  const valid = extension === 'webp' ? binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP'
    : extension === 'png' ? binary.startsWith('\x89PNG\r\n\x1a\n') : binary.startsWith('\xff\xd8\xff');
  if (!valid) throw new Error('INVALID_MEETUP_PHOTO');
  const path = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2).padEnd(16, '0')}.${extension}`;
  const result = await client.storage.from('meetup-profiles').upload(path, bytes.buffer, { contentType: photo.mimeType, cacheControl: '0', upsert: false });
  if (result.error) throw result.error;
  return path;
}

export async function loadMeetupProfilePhoto(client: SupabaseClient, path: string): Promise<string> {
  if (!photoPath.test(path)) throw new Error('INVALID_MEETUP_PHOTO');
  const result = await client.storage.from('meetup-profiles').download(path);
  if (result.error) throw result.error;
  if (!result.data || result.data.size > MAX_IMAGE_BYTES) throw new Error('INVALID_MEETUP_PHOTO');
  // No signed URL or disk cache: every new read goes through the storage policy.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('IMAGE_NOT_AVAILABLE'));
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/')
      ? resolve(reader.result) : reject(new Error('INVALID_MEETUP_PHOTO'));
    reader.readAsDataURL(result.data);
  });
}

export async function removeUnsavedMeetupPhotos(client: SupabaseClient, paths: string[]) {
  if (paths.length) await client.storage.from('meetup-profiles').remove([...new Set(paths)]).catch(() => {});
}

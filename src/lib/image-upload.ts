// 게시물 미디어의 단일 모듈. 사진·영상의 크기, 형식, 경로 규칙을 여기서만 정한다.
// 영상이나 외부 스토리지(R2 등)를 도입할 때도 이 파일만 고치면 된다.

export const MAX_POST_IMAGES = 10;
export const MAX_UPLOAD_DIMENSION = 1280;
export const FEED_THUMB_DIMENSION = 480;
export const TARGET_IMAGE_BYTES = 700 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const THUMB_SUFFIX = '.thumb';

export type PostMediaKind = 'image' | 'video';
export type PostMedia = {
  kind: PostMediaKind;
  path: string;
  thumbPath?: string;
  posterPath?: string;
  width?: number;
  height?: number;
  bytes?: number;
  mimeType?: string;
  durationSeconds?: number;
};

// 시도 순서대로 긴 변과 품질을 낮춘다. 앞 시도가 용량 예산을 넘으면 다음 시도로 넘어간다.
export const POST_IMAGE_ATTEMPTS = [
  { limit: MAX_UPLOAD_DIMENSION, quality: 0.72 },
  { limit: 1024, quality: 0.62 },
  { limit: 800, quality: 0.55 },
] as const;

// 사진은 항상 webp로 저장한다. 투명도를 유지하면서 PNG 스크린샷의 큰 용량 문제를 없앤다.
export function getPostImagePlan(width: number, height: number, limit = MAX_UPLOAD_DIMENSION, quality: number = POST_IMAGE_ATTEMPTS[0].quality) {
  const resize = width <= 0 || height <= 0 || Math.max(width, height) <= limit
    ? null
    : width >= height
      ? { width: limit }
      : { height: limit };
  return { resize, format: 'webp' as const, mimeType: 'image/webp' as const, quality };
}

export function estimatedBase64Bytes(base64: string) {
  return Math.ceil(base64.length * 0.75);
}

export function thumbPathFor(path: string) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? `${path}${THUMB_SUFFIX}.webp` : `${path.slice(0, dot)}${THUMB_SUFFIX}.webp`;
}

export function isThumbPath(path: string) {
  return path.includes(`${THUMB_SUFFIX}.`);
}

export function mediaKindForPath(path: string): PostMediaKind {
  return /\.(mp4|mov|m4v|webm)$/i.test(path) ? 'video' : 'image';
}

export function imageMedia(path: string, extra: Omit<PostMedia, 'kind' | 'path'> = {}): PostMedia {
  return { kind: 'image', path, thumbPath: thumbPathFor(path), ...extra };
}

export function canAddPostImage(current: number) {
  return current < MAX_POST_IMAGES;
}

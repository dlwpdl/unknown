export const MAX_POST_IMAGE_DIMENSION = 1600;

export function getPostImagePlan(width: number, height: number, mimeType: string) {
  const resize = width <= 0 || height <= 0 || Math.max(width, height) <= MAX_POST_IMAGE_DIMENSION
    ? null
    : width >= height
      ? { width: MAX_POST_IMAGE_DIMENSION }
      : { height: MAX_POST_IMAGE_DIMENSION };
  const format: 'jpeg' | 'png' | 'webp' = mimeType === 'image/png'
    ? 'png'
    : mimeType === 'image/webp'
      ? 'webp'
      : 'jpeg';
  const outputMimeType: 'image/jpeg' | 'image/png' | 'image/webp' = `image/${format}`;
  return { resize, format, mimeType: outputMimeType };
}

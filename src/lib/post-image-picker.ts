// 사진 선택 후 압축과 썸네일 생성만 담당한다. 규칙(크기·품질·형식)은 image-upload.ts에 있다.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  estimatedBase64Bytes,
  FEED_THUMB_DIMENSION,
  getPostImagePlan,
  MAX_IMAGE_BYTES,
  POST_IMAGE_ATTEMPTS,
  TARGET_IMAGE_BYTES,
} from './image-upload.ts';

export type PreparedImage = {
  uri: string;
  base64: string;
  thumbBase64?: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  bytes: number;
};

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function isSupportedImage(mimeType: string) {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType);
}

async function renderThumb(uri: string, width: number, height: number) {
  try {
    const plan = getPostImagePlan(width, height, FEED_THUMB_DIMENSION, 0.6);
    const context = ImageManipulator.manipulate(uri);
    // 목록용이므로 원본보다 크게 만들지 않는다(작은 사진은 그대로).
    if (plan.resize) context.resize(plan.resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ base64: true, compress: plan.quality, format: SaveFormat.WEBP });
    return saved.base64 ?? undefined;
  } catch {
    // 썸네일이 없으면 목록에서 원본으로 떨어진다.
    return undefined;
  }
}

// 목표 용량에 들어올 때까지 시도 순서대로 낮춘다. 모두 넘으면 실패로 알린다.
export async function preparePostImage(asset: ImagePicker.ImagePickerAsset, options: { withThumb?: boolean } = {}): Promise<PreparedImage> {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  let best: PreparedImage | null = null;
  for (const attempt of POST_IMAGE_ATTEMPTS) {
    const plan = getPostImagePlan(width, height, attempt.limit, attempt.quality);
    const context = ImageManipulator.manipulate(asset.uri);
    if (plan.resize) context.resize(plan.resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ base64: true, compress: plan.quality, format: SaveFormat.WEBP });
    if (!saved.base64) continue;
    const bytes = estimatedBase64Bytes(saved.base64);
    best = {
      uri: saved.uri, base64: saved.base64, mimeType: plan.mimeType,
      width: image.width, height: image.height, bytes,
    };
    if (bytes <= TARGET_IMAGE_BYTES) break;
  }
  if (!best) throw new Error('IMAGE_NOT_AVAILABLE');
  if (best.bytes > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  if (options.withThumb) best.thumbBase64 = await renderThumb(asset.uri, width, height);
  return best;
}

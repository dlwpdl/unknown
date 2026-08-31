export function buildSharedPostUrl(
  postId: string,
  appUrl = process.env.EXPO_PUBLIC_APP_URL,
  shareUrl = process.env.EXPO_PUBLIC_SHARE_URL,
) {
  const encodedId = encodeURIComponent(postId);
  if (shareUrl) return `${shareUrl.replace(/\/+$/, '')}?id=${encodedId}`;
  return appUrl
    ? `${appUrl.replace(/\/+$/, '')}/post/${encodedId}`
    : `gling://post/${encodedId}`;
}

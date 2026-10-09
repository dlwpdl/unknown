export function buildSharedPostUrl(
  postId: string,
  appUrl = process.env.EXPO_PUBLIC_APP_URL,
  shareUrl = process.env.EXPO_PUBLIC_SHARE_URL,
) {
  const encodedId = encodeURIComponent(postId);
  // Supabase serves Edge HTML as text/plain; send readers to the existing public web page.
  if (shareUrl && !/^https:\/\/[^/]+\.supabase\.co\/functions\/v1\/public-post(?:[/?#]|$)/i.test(shareUrl)) {
    return `${shareUrl.replace(/\/+$/, '')}?id=${encodedId}`;
  }
  return `${(appUrl || 'https://gling.ej-entertainment.com').replace(/\/+$/, '')}/post?id=${encodedId}`;
}

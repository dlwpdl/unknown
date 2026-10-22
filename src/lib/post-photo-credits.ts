export function splitPostPhotoCredits(body: string) {
  const marker = '\n\n사진 출처·이용 조건\n';
  const offset = body.lastIndexOf(marker);
  if (offset < 0) return { body, credits: '' };
  const credits = body.slice(offset + marker.length).trim();
  if (!/https:\/\/(?:unsplash\.com|commons\.wikimedia\.org|creativecommons\.org)\//.test(credits)) {
    return { body, credits: '' };
  }
  return { body: body.slice(0, offset).trimEnd(), credits };
}

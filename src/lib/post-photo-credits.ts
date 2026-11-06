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

// The one-line caption on feed photos: who made them. Links and license terms stay with the post.
export function photoCreditNames(credits: string): string[] {
  const lines = credits.split('\n').map(line => line.trim()).filter(Boolean);
  const numbered = lines.flatMap(line => /^\d+[.)]\s*(.+)$/.exec(line)?.[1] ?? []);
  return [...new Set((numbered.length ? numbered : lines.slice(0, 1)).map(line => line.replace(/https?:\/\/\S+/g, '')
    .replace(/^(?:사진|photos?)(?:\s*[:：]|\s+by)\s*/i, '').replace(/^[\s·/|,:]+/, '').split(/\s+[·/|]\s+|,\s+/)[0].trim()).filter(Boolean))];
}

import { PUBLIC_SOURCE } from './public-seo.ts';

const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const POST = new RegExp(`^business-post/(${UUID})/([0-9]|1[0-9])/([0-9a-f]{32})$`, 'i');
const PROFILE = new RegExp(`^business-profile/(${UUID})/(avatar|banner|map)/([0-9a-f]{32})$`, 'i');

export function businessMediaUrl(path: string): string | null {
  const post = POST.exec(path), profile = PROFILE.exec(path);
  if (!post && !profile) return null;
  const [, id, kind, version] = (post ?? profile)!;
  return `${PUBLIC_SOURCE}?format=business-image&id=${id}&kind=${post ? 'post' : kind}&index=${post ? kind : '0'}&v=${version}`;
}

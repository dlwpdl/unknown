import { merchantPhoneUrl, safeMerchantSourceUrl } from './merchant-source.ts';

// Only booking sites seen taking Vancouver reservations (2026-11-04: OpenTable's Vancouver list, Tock's Vancouver city
// page, Resy's Canada pages). A business's own website is never called a booking link.
export const RESERVATION_HOSTS = ['opentable.com', 'opentable.ca', 'resy.com', 'exploretock.com'] as const;

export type Reservation = { kind: 'link'; url: string } | { kind: 'phone'; url: string } | { kind: 'message' };

export function reservationLink(urls: readonly unknown[]): string | null {
  for (const value of urls) {
    const url = typeof value === 'string' ? safeMerchantSourceUrl(value) : null;
    const host = url ? new URL(url).hostname.toLowerCase() : '';
    if (url && RESERVATION_HOSTS.some(domain => host === domain || host.endsWith('.' + domain))) return url;
  }
  return null;
}

/** The first path the place already has: a booking site, then the public phone, then a Gling message. */
export function reservationAction({ links = [], phone = '', canMessage = false }: { links?: readonly unknown[]; phone?: string; canMessage?: boolean }): Reservation | null {
  const url = reservationLink(links);
  if (url) return { kind: 'link', url };
  const tel = merchantPhoneUrl(phone);
  if (tel) return { kind: 'phone', url: tel };
  return canMessage ? { kind: 'message' } : null;
}

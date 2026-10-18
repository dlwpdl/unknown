export type WebAdConfig = { client: string; slot: string; origin: string; cmpId: number };
export type AdSurface = 'feed' | 'events' | 'map';
export type WebAdStatus = 'pending' | 'filled' | 'unfilled';

export function parseWebAdConfig(input: { enabled?: unknown; client?: unknown; slot?: unknown; origin?: unknown; cmpId?: unknown }): WebAdConfig | null {
  if (input.enabled !== 'true' || typeof input.client !== 'string' || !/^ca-pub-\d{16}$/.test(input.client)
    || typeof input.slot !== 'string' || !/^\d{10}$/.test(input.slot)
    || typeof input.origin !== 'string' || !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(input.origin)
    || typeof input.cmpId !== 'string' || !/^[1-9]\d{0,4}$/.test(input.cmpId)) return null;
  return { client: input.client, slot: input.slot, origin: input.origin, cmpId: Number(input.cmpId) };
}

export function webAdPageAllowed(config: WebAdConfig, location: Pick<Location, 'origin' | 'pathname' | 'search'>, surface: AdSurface): boolean {
  const paths = { feed: ['/', '/meetups'], events: ['/events'], map: ['/map'] };
  return location.origin === config.origin && paths[surface].includes(location.pathname.replace(/\/$/, '') || '/')
    && [...new URLSearchParams(location.search).keys()].every(key => ['city', 'tag', 'category', 'date'].includes(key));
}

type TCData = {
  cmpId?: number; listenerId?: number; cmpStatus?: string; eventStatus?: string; tcString?: string;
  vendor?: { consents?: Record<number, boolean> }; purpose?: { consents?: Record<number, boolean> };
};
type TcfApi = (command: string, version: number, callback: (data: TCData | null, success: boolean) => void, id?: number) => void;
type ConsentWindow = { __tcfapi?: TcfApi };
type AdWindow = Window & typeof globalThis & { adsbygoogle?: { push: (request: object) => unknown } };

// Read an existing, verified certified CMP; native UMP and build-time flags are not visitor consent.
// https://support.google.com/adsense/answer/9804260
export function observeWebAdConsent(cmpId: number, onChange: (allowed: boolean) => void, win: ConsentWindow = window as ConsentWindow) {
  let active = true, listenerId: number | undefined;
  const api = win.__tcfapi;
  onChange(false);
  const remove = () => { if (listenerId !== undefined) { try { api?.('removeEventListener', 2, () => {}, listenerId); } catch { /* Fail closed. */ } } };
  if (api) try {
    api('addEventListener', 2, (data, success) => {
      if (Number.isSafeInteger(data?.listenerId)) listenerId = data!.listenerId;
      if (!active) { remove(); return; }
      onChange(success === true && data?.cmpId === cmpId && data.cmpStatus === 'loaded'
        && ['tcloaded', 'useractioncomplete'].includes(data.eventStatus ?? '') && typeof data.tcString === 'string' && data.tcString.length > 0
        && data.vendor?.consents?.[755] === true && [1, 2, 7, 9, 10].every(id => data.purpose?.consents?.[id] === true));
    });
  } catch { onChange(false); }
  return () => { active = false; remove(); };
}

const scriptLoads = new WeakMap<Document, { client: string; ready: Promise<boolean> }>();
const requestedUnits = new WeakSet<HTMLElement>();

function loadScript(config: WebAdConfig, doc: Document): Promise<boolean> {
  const previous = scriptLoads.get(doc);
  if (previous) return previous.client === config.client ? previous.ready : Promise.resolve(false);
  const ready = new Promise<boolean>(resolve => {
    const script = doc.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}`;
    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    doc.head.appendChild(script);
  });
  scriptLoads.set(doc, { client: config.client, ready });
  return ready;
}

// https://support.google.com/adsense/answer/9183460 (tag), /10762946 (unfilled status).
export function mountWebAdUnit(unit: HTMLElement, config: WebAdConfig, isAllowed: () => boolean, onStatus: (status: WebAdStatus) => void, win: AdWindow = window as AdWindow) {
  const doc = win.document;
  let active = true, near = false, started = false;
  onStatus('pending');
  if (!win.IntersectionObserver || !win.MutationObserver || !isAllowed()) return () => {};
  const request = async () => {
    if (!active || started || !near || doc.visibilityState !== 'visible' || !isAllowed() || !unit.isConnected || unit.getBoundingClientRect().width <= 0 || requestedUnits.has(unit)) return;
    started = true;
    const ready = await loadScript(config, doc);
    if (!active || !isAllowed() || !unit.isConnected) return;
    if (!ready) { onStatus('unfilled'); return; }
    if (!near || doc.visibilityState !== 'visible') { started = false; return; }
    try {
      requestedUnits.add(unit);
      (win.adsbygoogle ??= [] as object[]).push({});
    } catch { onStatus('unfilled'); }
  };
  const intersection = new win.IntersectionObserver(entries => {
    near = entries.some(entry => entry.isIntersecting);
    void request();
  }, { rootMargin: '200px 0px' });
  const mutation = new win.MutationObserver(() => {
    if (!active) return;
    const status = unit.getAttribute('data-ad-status');
    if (status === 'filled') onStatus('filled');
    else if (status === 'unfilled' || status === 'unfill-optimized') onStatus('unfilled');
  });
  const visibility = () => { void request(); };
  intersection.observe(unit);
  mutation.observe(unit, { attributes: true, attributeFilter: ['data-ad-status'] });
  doc.addEventListener('visibilitychange', visibility);
  return () => { active = false; intersection.disconnect(); mutation.disconnect(); doc.removeEventListener('visibilitychange', visibility); };
}

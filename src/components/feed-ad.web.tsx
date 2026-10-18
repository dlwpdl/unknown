import { useEffect, useRef, useState } from 'react';
import { WebNightColors } from '@/constants/theme';
import { webAdConfig } from '@/lib/ads.web';
import { mountWebAdUnit, observeWebAdConsent, webAdPageAllowed, type AdSurface, type WebAdStatus } from '@/lib/adsense';

export function FeedAd({ surface = 'feed' }: { surface?: AdSurface } = {}) {
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus] = useState<WebAdStatus>('pending');
  const consent = useRef(false);
  const unit = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!webAdConfig || !webAdPageAllowed(webAdConfig, window.location, surface)) return;
    return observeWebAdConsent(webAdConfig.cmpId, value => { consent.current = value; setAllowed(value); });
  }, [surface]);
  useEffect(() => {
    const config = webAdConfig;
    if (!config || !allowed || !unit.current) return;
    return mountWebAdUnit(unit.current, config,
      () => consent.current && webAdPageAllowed(config, window.location, surface), setStatus);
  }, [allowed, surface]);
  if (!webAdConfig || !allowed) return null;
  // Retain blank measured space on no-fill so already-read content cannot jump.
  return <section aria-label="Advertisement" aria-hidden={status !== 'filled'} data-ad-status={status} style={{
    boxSizing: 'border-box', width: '100%', minHeight: 302, marginBlock: 24, padding: 12,
    visibility: status === 'unfilled' ? 'hidden' : 'visible',
    background: status === 'filled' ? `var(--card, ${WebNightColors.card})` : 'transparent',
    border: `1px solid ${status === 'filled' ? `var(--line, ${WebNightColors.line})` : 'transparent'}`, borderRadius: 16,
  }}>
    <span style={{ display: 'block', height: 18, marginBottom: 8, fontSize: 12, lineHeight: '18px', fontWeight: 700,
      visibility: status === 'filled' ? 'visible' : 'hidden', color: `var(--textSecondary, ${WebNightColors.textSecondary})` }}>Ad</span>
    <ins ref={unit} style={{ display: status === 'unfilled' ? 'none' : 'block', width: '100%', height: 250 }}
      data-ad-client={webAdConfig.client} data-ad-slot={webAdConfig.slot} data-ad-format="auto" data-full-width-responsive="false" />
  </section>;
}

import './app-store-choices.css';
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
// shortcut: toqr is locked through Expo CLI; recheck this import when upgrading Expo.
import { toQR } from 'toqr';

import { ControlMetrics, ControlMotion, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const stores = { ios: 'https://apps.apple.com/ca/app/id6809273242', android: 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling' };
// Android is closed testing; testers are added by Google account, so ask for the Gmail address up front.
const androidTester = `mailto:gling@ej-entertainment.com?subject=${encodeURIComponent('Android 테스트 참여 신청')}&body=${encodeURIComponent('Google Play에서 쓰는 Gmail 주소: ')}`;
// Google Play hands this to the install referrer. App Store campaign links need a provider token (pt) we don't have yet.
const playUrl = () => `${stores.android}&referrer=${encodeURIComponent(`utm_source=web&utm_campaign=${window.location.pathname.split('/')[1]?.replace(/[^a-z0-9-]/gi, '') || 'home'}`)}`;
const noDeviceChange = () => () => {};
const readDevice = () => {
  const agent = navigator.userAgent;
  // iPadOS reports a Mac user agent; touch support tells them apart.
  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(agent) ? 'android' : 'desktop';
};
/** null until hydrated, so the static HTML keeps the desktop layout. */
export function useDevice() {
  return useSyncExternalStore(noDeviceChange, readDevice, () => null);
}

/** One tap to the right install path: App Store on iPhone, tester request on Android, QR choice on a computer. */
export function InstallAction({ className, onPress }: { className?: string; onPress?: () => void }) {
  const { language } = useLanguage(), ko = language === 'ko';
  const device = useDevice();
  return device === 'ios' ? <a data-analytics="web.install.ios" className={className} href={stores.ios} onClick={onPress}>{ko ? 'App Store에서 무료로 받기' : 'Get it free on the App Store'}</a>
    : device === 'android' ? <a data-analytics="web.install.android" className={className} href={androidTester} onClick={onPress}>{ko ? 'Android 테스트 참여 신청' : 'Ask to join the Android test'}</a>
      : <a data-analytics="web.install.desktop" className={className} href="#app" onClick={onPress}>{ko ? '휴대폰에 앱 받기' : 'Get the app on your phone'}</a>;
}

export function AppStoreChoices() {
  const { language } = useLanguage(), ko = language === 'ko';
  const theme = useTheme(), { play } = useInteractionFeedback(), device = useDevice();
  const [store, setStore] = useState<keyof typeof stores | null>(null);
  const url = store === 'ios' ? stores.ios : store ? playUrl() : null;
  const qr = useMemo(() => {
    if (!url) return null;
    try {
      const cells = toQR(url), size = Math.sqrt(cells.length);
      return Number.isInteger(size) ? { extent: size + 8, path: [...cells].flatMap((cell, index) => cell ? [`M${index % size + 4} ${Math.floor(index / size) + 4}h1v1h-1z`] : []).join('') } : null;
    } catch { return null; }
  }, [url]);
  const style = { ...Object.fromEntries(Object.entries(theme).map(([key, value]) => [`--${key}`, value])),
    '--store-gap': `${Spacing.three}px`, '--store-small-gap': `${Spacing.two}px`, '--store-action': `${ControlMetrics.action}px`,
    '--store-radius': `${ControlMetrics.radius.action}px`, '--store-pressed': ControlMotion.pressedOpacity,
    '--store-body': `${Typography.menu.fontSize / 16}rem`, '--store-heading': `${Typography.section.fontSize / 16}rem` } as CSSProperties;
  if (device === 'ios' || device === 'android') return <section className="public-app-stores" style={style} aria-label={ko ? '글링 앱 설치 안내' : 'Get the Gling app'}>
    <div className="public-app-store-result">
      <InstallAction className="public-app-store-primary" onPress={() => play('selection')} />
      {device === 'android' && <>
        <p>{ko ? 'Android는 비공개 테스트 중이에요. 신청 메일을 보내 주시면 테스트에 추가해 드려요. 이미 테스트에 참여했다면 Google Play에서 바로 받을 수 있어요.' : 'Android is in private testing. Email us and we’ll add you as a tester. Already a tester? Get it on Google Play.'}</p>
        <a data-analytics="web.store.android.open" href={playUrl()} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{ko ? 'Google Play에서 확인' : 'View on Google Play'} <span aria-hidden="true">↗</span></a>
      </>}
    </div>
  </section>;
  return <section className="public-app-stores" style={style} aria-label={ko ? '글링 앱 설치 안내' : 'Get the Gling app'}>
    <h3>{ko ? '아직 앱이 없나요?' : 'Need the app?'}</h3><p>{ko ? '휴대폰의 스토어를 선택해 주세요.' : 'Choose your phone’s store.'}</p>
    <div className="public-app-store-picker" role="group" aria-label={ko ? '앱 스토어 선택' : 'Choose an app store'}>
      <button data-analytics="web.store.ios" type="button" aria-pressed={store === 'ios'} onClick={() => { play('selection'); setStore('ios'); }}>App Store</button>
      <button data-analytics="web.store.android" type="button" aria-pressed={store === 'android'} onClick={() => { play('selection'); setStore('android'); }}>Google Play</button>
    </div>
    {store && url && <div className="public-app-store-result" aria-live="polite">
      {qr && <svg role="img" aria-label={`${store === 'ios' ? 'App Store' : 'Google Play'} ${ko ? '설치 안내 QR 코드' : 'download QR code'}`} viewBox={`0 0 ${qr.extent} ${qr.extent}`} width={180} height={180} shapeRendering="crispEdges">
        <rect width={qr.extent} height={qr.extent} fill="#fff" /><path d={qr.path} fill="#000" /></svg>}
      {store === 'ios' ? <a data-analytics="web.store.ios.open" href={url} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{ko ? 'App Store에서 받기' : 'Get it on the App Store'} <span aria-hidden="true">↗</span></a>
        : <a data-analytics="web.store.android.open" href={url} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{ko ? 'Google Play에서 확인' : 'View on Google Play'} <span aria-hidden="true">↗</span></a>}
      {!qr && <p>{ko ? 'QR 코드 대신 위 스토어 링크를 이용해 주세요.' : 'Use the store link above if the QR code is unavailable.'}</p>}
      <p>{ko ? '설치 후 이 페이지로 돌아와 앱에서 이어가세요.' : 'After installing, return to this page and open the meetup or story in the app.'}</p>
      {store === 'android' && <><p>{ko ? 'Android는 비공개 테스트 중이며 공개 출시를 준비하고 있어요. 테스트 참여 대상만 설치할 수 있어요.' : 'Android is in private testing, with a public release on the way. For now, only eligible testers can install it.'}</p>
        <a data-analytics="web.install.android" href={androidTester} onClick={() => play('selection')}>{ko ? 'Android 테스트 참여 신청' : 'Ask to join the Android test'}</a></>}
    </div>}
    <noscript><div className="public-app-store-result">
      <a href={stores.ios} target="_blank" rel="noopener noreferrer">{ko ? 'App Store에서 받기' : 'Get it on the App Store'}</a>
      <a href={stores.android} target="_blank" rel="noopener noreferrer">{ko ? 'Google Play에서 확인' : 'View on Google Play'}</a>
      <p>{ko ? 'Android는 비공개 테스트 중이며 테스트 참여 대상만 설치할 수 있어요.' : 'Android is in private testing. Only eligible testers can install it.'}</p>
    </div></noscript>
  </section>;
}

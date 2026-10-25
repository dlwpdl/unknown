import './app-store-choices.css';
import { useMemo, useState, type CSSProperties } from 'react';
// shortcut: toqr is locked through Expo CLI; recheck this import when upgrading Expo.
import { toQR } from 'toqr';

import { ControlMetrics, ControlMotion, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const stores = { ios: 'https://apps.apple.com/ca/app/id6809273242', android: 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling' };
export function AppStoreChoices() {
  const { language } = useLanguage(), ko = language === 'ko';
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [store, setStore] = useState<keyof typeof stores | null>(null);
  const url = store ? stores[store] : null;
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
  return <section className="public-app-stores" style={style} aria-label={ko ? '글링 앱 설치 안내' : 'Get the Gling app'}>
    <h3>{ko ? '아직 앱이 없나요?' : 'Need the app?'}</h3><p>{ko ? '휴대폰의 스토어를 선택해 주세요.' : 'Choose your phone’s store.'}</p>
    <div className="public-app-store-picker" role="group" aria-label={ko ? '앱 스토어 선택' : 'Choose an app store'}>
      <button type="button" aria-pressed={store === 'ios'} onClick={() => { play('selection'); setStore('ios'); }}>App Store</button>
      <button type="button" aria-pressed={store === 'android'} onClick={() => { play('selection'); setStore('android'); }}>Google Play</button>
    </div>
    {store && url && <div className="public-app-store-result" aria-live="polite">
      {qr && <svg role="img" aria-label={`${store === 'ios' ? 'App Store' : 'Google Play'} ${ko ? '설치 안내 QR 코드' : 'download QR code'}`} viewBox={`0 0 ${qr.extent} ${qr.extent}`} width={180} height={180} shapeRendering="crispEdges">
        <rect width={qr.extent} height={qr.extent} fill="#fff" /><path d={qr.path} fill="#000" /></svg>}
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{store === 'ios' ? ko ? 'App Store에서 받기' : 'Get it on the App Store' : ko ? 'Google Play에서 확인' : 'View on Google Play'} <span aria-hidden="true">↗</span></a>
      {!qr && <p>{ko ? 'QR 코드 대신 위 스토어 링크를 이용해 주세요.' : 'Use the store link above if the QR code is unavailable.'}</p>}
      <p>{ko ? '설치 후 이 페이지로 돌아와 앱에서 이어가세요.' : 'After installing, return to this page and open the meetup or story in the app.'}</p>
      {store === 'android' && <p>{ko ? 'Android는 비공개 테스트 중이며 공개 출시를 준비하고 있어요. 테스트 참여 대상만 설치할 수 있어요.' : 'Android is in private testing and its public release is being prepared. Installation is currently limited to eligible testers.'}</p>}
    </div>}
    <noscript><div className="public-app-store-result">
      <a href={stores.ios} target="_blank" rel="noopener noreferrer">{ko ? 'App Store에서 받기' : 'Get it on the App Store'}</a>
      <a href={stores.android} target="_blank" rel="noopener noreferrer">{ko ? 'Google Play에서 확인' : 'View on Google Play'}</a>
      <p>{ko ? 'Android는 비공개 테스트 중이며 테스트 참여 대상만 설치할 수 있어요.' : 'Android is in private testing. Installation is limited to eligible testers.'}</p>
    </div></noscript>
  </section>;
}

import './reader.css';
import { Asset } from 'expo-asset';
import type { CSSProperties } from 'react';

import { WebNightColors } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { CONTACT_EMAIL } from '@/lib/contact';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { PUBLIC_CHANNELS } from '@/lib/public-seo';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const cities = CITIES.filter((city) => city.state === 'open');
export const readerPalette = Object.fromEntries(Object.entries(WebNightColors).map(([key, value]) => [`--${key}`, value])) as CSSProperties;

type Menu = 'today' | 'meetups' | 'festival' | 'places' | 'visited';
type Language = 'ko' | 'en';

// Every public page shares this header and footer, so the menu order, logo and business button stay the same everywhere.
// `language` pins the labels on a page written in one language (/en).
export function PublicHeader({ cityId, placesCityId, current, language: fixed }: { cityId?: string; placesCityId?: string; current?: Menu; language?: Language }) {
  const { play } = useInteractionFeedback(), { isAuthed } = useAuth(), { language } = useLanguage(), ko = (fixed ?? language) === 'ko';
  const city = cities.find((item) => item.id === cityId)?.id ?? cities[0].id;
  const page = (menu: Menu) => current === menu ? 'page' : undefined;
  return <header className="reader-header">
    <a data-analytics="web_control_5" className="reader-brand" href="/" aria-label={ko ? '글링 홈' : 'Gling home'} onClick={() => play('selection')}><img src={wordmark} alt="gling" width="144" height="60" /></a>
    <nav aria-label={ko ? '주요 메뉴' : 'Main navigation'}>
      <a href={`/${city}`} aria-current={page('today')} onClick={() => play('selection')}>{ko ? '오늘' : 'Today'}</a>
      <a data-analytics="web_control_7" href={`/meetups?city=${city}`} aria-current={page('meetups')} onClick={() => play('selection')}>{ko ? '모임' : 'Meetups'}</a>
      <a data-analytics="web_control_6" href={`/?city=${city}&tag=festival#stories`} aria-current={page('festival')} onClick={() => play('selection')}>{ko ? '페스티벌' : 'Festivals'}</a>
      <a href={`/${placesCityId ?? city}/places`} aria-current={page('places')} onClick={() => play('selection')}>{ko ? '장소' : 'Places'}</a>
      <a href="/visited" aria-current={page('visited')} onClick={() => play('selection')}>Gling Visited</a>
    </nav>
    <a className="reader-header-account" href="/merchant/" rel="nofollow" onClick={() => play('selection')}>{isAuthed ? ko ? '비즈니스 관리' : 'Manage business' : ko ? '비즈니스 로그인' : 'Business sign-in'}</a>
  </header>;
}

export function PublicFooter({ language: fixed }: { language?: Language }) {
  const { play } = useInteractionFeedback(), { language } = useLanguage(), ko = (fixed ?? language) === 'ko';
  return <footer className="reader-footer"><div className="reader-footer-brand"><span>{ko ? 'gling · 같이 갈 사람, 같이 나눌 이야기' : 'gling · People to go with, stories to share'}</span>
    <nav aria-label={ko ? '글링 연락처와 SNS' : 'Contact and social links'}><a href={`mailto:${CONTACT_EMAIL}`} onClick={() => play('selection')}>{CONTACT_EMAIL}</a>{PUBLIC_CHANNELS.map(channel => <a key={channel.url} href={channel.url} rel="me noopener" onClick={() => play('selection')}>{!ko && 'englishName' in channel ? channel.englishName : channel.name}</a>)}</nav></div><nav aria-label={ko ? '정책' : 'Policies'}><a href="/immigration" onClick={() => play('selection')}>{ko ? '이민·유학 길잡이' : 'Immigration guide (Korean)'}</a><a href="/business" onClick={() => play('selection')}>{ko ? '비즈니스 등록·관리' : 'List or manage your business'}</a><a data-analytics="web_control_18" href="/terms" onClick={() => play('selection')}>{ko ? '이용약관' : 'Terms'}</a><a data-analytics="web_control_19" href="/privacy" onClick={() => play('selection')}>{ko ? '개인정보처리방침' : 'Privacy'}</a><a data-analytics="web_control_20" href="/account-deletion" onClick={() => play('selection')}>{ko ? '계정 삭제' : 'Delete account'}</a></nav></footer>;
}

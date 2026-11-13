import './business.css';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PUBLIC_PLAY_STORE, publicImmigrationMeta } from '@/lib/public-seo';
import { IMMIGRATION_SECTIONS } from './metadata';

const CITY_GUIDES = [['vancouver', '밴쿠버'], ['toronto', '토론토'], ['montreal', '몬트리올']] as const;

export default function PublicImmigration() {
  const { play } = useInteractionFeedback();
  const tap = () => play('selection');
  return <div className="biz" lang="ko">
    <main className="biz-main">
      <nav aria-label="경로" className="biz-kicker"><a href="/" onClick={tap}>글링</a> › 이민·유학 길잡이</nav>
      <h1>{publicImmigrationMeta.heading}</h1>
      <p className="biz-lede">이민이든 유학이든 워킹홀리데이든 배우자 비자든, 신청은 결국 IRCC나 주정부 페이지에서 하게 돼요. 그래서 처음 열어 볼 공식 페이지만 골라 모았고, 조건과 처리 기간은 자주 바뀌어서 숫자는 적지 않았어요.</p>
      {IMMIGRATION_SECTIONS.map(section => <section key={section.id} aria-labelledby={`im-${section.id}`}>
        <h2 id={`im-${section.id}`}>{section.title}</h2>
        <ul className="biz-examples">{section.links.map(link => <li key={link.url}><a href={link.url} rel="noopener" onClick={tap}><strong>{link.name}</strong><span>{link.about}</span></a></li>)}</ul>
      </section>)}
      <section aria-labelledby="im-arrive"><h2 id="im-arrive">캐나다에 도착하면</h2>
        <p>의료보험이나 운전면허는 주마다 달라서, 도착하고 바로 챙길 것들은 도시별 정착 가이드에 따로 모았어요.</p>
        <ul className="biz-examples">{CITY_GUIDES.map(([id, name]) => <li key={id}><a href={`/${id}/settlement`} onClick={tap}><strong>{name} 정착 가이드</strong><span>{name}에 와서 먼저 챙길 것</span></a></li>)}</ul>
        <p style={{ marginTop: 16 }}>먼저 와서 지내는 한인들한테 직접 묻고 싶은 건 글링 앱에 올리면 돼요. <a href="https://apps.apple.com/ca/app/id6809273242" onClick={tap}>iPhone 앱 받기</a> · <a href={PUBLIC_PLAY_STORE} onClick={tap}>Android 앱 받기</a></p>
      </section>
      <p className="biz-note" style={{ marginTop: 40 }}>확인 날짜 {publicImmigrationMeta.checked}. 이 페이지는 정부 공식 페이지로 가는 길잡이고 법률 조언이 아니에요. 내 상황에 맞는지는 신청 전에 공식 페이지나 등록된 전문가에게 확인해 주세요.</p>
      <p className="biz-footer"><a href="/" onClick={tap}>글링 공개 게시판</a> · <a href="/meetups" onClick={tap}>한인 모임·소모임</a> · <a href="/faq" onClick={tap}>자주 묻는 질문</a></p>
    </main>
  </div>;
}

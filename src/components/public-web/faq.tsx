import { FAQ_ITEMS } from './metadata';

export default function PublicFaq() {
  return (
    <div style={{ backgroundColor: '#0D0C10', color: '#F6F3F0', minHeight: '100%' }}>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 48px', font: '16px/1.7 system-ui, sans-serif' }}>
        <p style={{ margin: '0 0 8px', color: '#CBB9FF', fontSize: 13, fontWeight: 700 }}>글링 | 캐나다 한인 커뮤니티</p>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.35 }}>자주 묻는 질문</h1>
        <p style={{ margin: '0 0 32px', color: '#B9B2C8' }}>캐나다 한인 모임 커뮤니티 글링에 대해 많이 묻는 질문을 모았어요.</p>
        {FAQ_ITEMS.map(item => (
          <section key={item.question} style={{ margin: '0 0 28px' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 19, lineHeight: 1.4 }}>{item.question}</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{item.answer}</p>
          </section>
        ))}
        <p style={{ margin: '32px 0 0' }}>
          <a href="/" style={{ color: '#CBB9FF' }}>글링 공개 게시판 보기</a>
          {' · '}
          <a href="https://apps.apple.com/ca/app/id6809273242" style={{ color: '#CBB9FF' }}>iPhone 앱 다운로드</a>
        </p>
      </main>
    </div>
  );
}

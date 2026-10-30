import Head from 'expo-router/head';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { jsonLd, publicAboutGlingEn, publicDisambiguation, PUBLIC_SITE } from '@/lib/public-seo';

const FAQ = [
  { question: 'What is Gling?', answer: 'A community app for Koreans living in Vancouver, Toronto and Montreal. People share neighbourhood stories, food spots, rentals, jobs and used goods, find company for festivals and concerts, and start or join small meetups.' },
  { question: 'Is it free?', answer: 'Yes. Gling is free to use; some features are in-app purchases.' },
  { question: 'Do I have to write in Korean?', answer: 'No. You can post in Korean or English, and translation lets you read posts in the other language.' },
  { question: 'Can I read without signing up?', answer: 'Public posts can be previewed on the web. Sign in to read full posts; commenting, chatting and joining meetups happen in the app.' },
  { question: 'Which phones are supported?', answer: 'The iPhone app is on the App Store. Android is in closed testing.' },
];
const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${PUBLIC_SITE}/en#faq`, url: `${PUBLIC_SITE}/en`, inLanguage: 'en',
  mainEntity: FAQ.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) };
const link = { color: '#CBB9FF' };

// One English page for people (and AI answers) searching in English; the community itself is in Korean.
export default function PublicEnglish() {
  const { play } = useInteractionFeedback();
  return <div lang="en" style={{ backgroundColor: '#0D0C10', color: '#F6F3F0', minHeight: '100%' }}>
    <Head>
      <link rel="alternate" hrefLang="ko" href={`${PUBLIC_SITE}/`} /><link rel="alternate" hrefLang="en" href={`${PUBLIC_SITE}/en`} /><link rel="alternate" hrefLang="x-default" href={`${PUBLIC_SITE}/`} />
      <script type="application/ld+json">{jsonLd(schema)}</script>
    </Head>
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 48px', font: '16px/1.7 system-ui, sans-serif' }}>
      <p style={{ margin: '0 0 8px', color: '#CBB9FF', fontSize: 13, fontWeight: 700 }}>Gling · 글링</p>
      <h1 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.35 }}>Gling, the Korean community app in Canada</h1>
      <p style={{ margin: '0 0 12px' }}>{publicAboutGlingEn}</p>
      <p style={{ margin: '0 0 24px', color: '#B9B2C8' }}>{publicDisambiguation}</p>
      <p style={{ margin: '0 0 32px' }}>
        <a href="https://apps.apple.com/ca/app/id6809273242" style={link} onClick={() => play('selection')}>Get the iPhone app</a>
        {' · '}<a href="/vancouver" style={link} hrefLang="ko" onClick={() => play('selection')}>Vancouver</a>
        {' · '}<a href="/toronto" style={link} hrefLang="ko" onClick={() => play('selection')}>Toronto</a>
        {' · '}<a href="/montreal" style={link} hrefLang="ko" onClick={() => play('selection')}>Montreal</a>
        {' · '}<a href="/" style={link} hrefLang="ko" onClick={() => play('selection')}>한국어</a>
      </p>
      {FAQ.map(item => <section key={item.question} style={{ margin: '0 0 24px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 19, lineHeight: 1.4 }}>{item.question}</h2>
        <p style={{ margin: 0 }}>{item.answer}</p>
      </section>)}
    </main>
  </div>;
}

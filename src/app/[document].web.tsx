import './index.web.css';
import './legal.web.css';

import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { Asset } from 'expo-asset';
import type { CSSProperties } from 'react';
import { WebNightColors } from '@/constants/theme';

import { LEGAL_DOCUMENTS, type LegalDocument, type LegalDocumentSlug } from '@/lib/legal-documents';

const LEGAL_LINKS = [
  { slug: 'terms', label: '이용약관' },
  { slug: 'privacy', label: '개인정보처리방침' },
  { slug: 'account-deletion', label: '계정 삭제' },
  { slug: 'child-safety', label: '아동 안전' },
] as const;
const wordmark = Asset.fromModule(require('@/assets/brand/gling-night-wordmark.png')).uri;

export function generateStaticParams() {
  return LEGAL_LINKS.map(({ slug }) => ({ document: slug }));
}

export default function LegalDocumentPage() {
  const { document } = useLocalSearchParams<{ document: string }>();
  const slug = document as LegalDocumentSlug;
  const page = LEGAL_DOCUMENTS[slug] as LegalDocument | undefined;

  if (!page) {
    return (
      <main className="legal-missing">
        <h1>페이지를 찾을 수 없습니다.</h1>
        <a href="./">gling으로 돌아가기</a>
      </main>
    );
  }

  return (
    <div className="site-page legal-page" style={{
      '--bg': WebNightColors.background,
      '--panel': WebNightColors.card,
      '--text': WebNightColors.text,
      '--muted': WebNightColors.textSecondary,
      '--line': WebNightColors.line,
      '--line-strong': WebNightColors.backgroundSelected,
      '--accent': WebNightColors.accent,
      '--accent-fill': WebNightColors.accentFill,
      '--accent-ink': WebNightColors.accentInk,
      '--accent-soft': WebNightColors.backgroundElement,
      '--navy': WebNightColors.navy,
    } as CSSProperties}>
      <Head>
        <title>{`${page.title} | gling`}</title>
        <meta name="description" content={page.summary} />
      </Head>

      <div className="legal-shell">
        <header className="legal-topbar">
          <a className="legal-brand" href="./" aria-label="gling 홈">
            <img src={wordmark} width="96" alt="gling" />
          </a>
          <nav aria-label="법적 문서">
            {LEGAL_LINKS.map((link) => (
              <a key={link.slug} href={`./${link.slug}`} aria-current={link.slug === slug ? 'page' : undefined}>
                {link.label}
              </a>
            ))}
          </nav>
        </header>

        <main>
          <header className="legal-hero">
            <span>{page.eyebrow}</span>
            <h1>{page.title}</h1>
            <p>{page.summary}</p>
            <small>시행일 {page.effectiveDate}</small>
            {slug === 'account-deletion' && (
              <a className="legal-request" href="mailto:eunsense0308@gmail.com?subject=gling%20계정%20삭제%20요청">
                계정 삭제 요청 이메일 보내기
              </a>
            )}
          </header>

          <div className="legal-layout">
            <aside aria-label="문서 목차">
              <strong>목차</strong>
              {page.sections.map((section, index) => (
                <a key={section.title} href={`#section-${index + 1}`}>
                  {section.title}
                </a>
              ))}
            </aside>

            <article className="legal-content">
              {page.sections.map((section, index) => (
                <section key={section.title} id={`section-${index + 1}`}>
                  <h2>{section.title}</h2>
                  {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.bullets && (
                    <ul>
                      {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  )}
                </section>
              ))}
            </article>
          </div>
        </main>

        <footer className="legal-footer">
          <img src={wordmark} width="92" alt="gling" />
          <a href="mailto:eunsense0308@gmail.com">eunsense0308@gmail.com</a>
        </footer>
      </div>
    </div>
  );
}

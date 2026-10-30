import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import { Children, cloneElement, isValidElement, type PropsWithChildren } from 'react';
import { WebNightColors } from '@/constants/theme';
import { publicFaqSchema, publicHomeSchema } from '@/components/public-web/metadata';
import { jsonLd } from '@/lib/public-seo';

export default function RootHtml({ children, pathname }: PropsWithChildren<{ pathname: string }>) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="ko" style={{ ...htmlAttributes?.style, backgroundColor: WebNightColors.background, colorScheme: 'dark' }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content={WebNightColors.background} />
        {/* iPhone Safari's Smart App Banner on every public page; prerendered posts add their own app-argument. */}
        <meta name="apple-itunes-app" content="app-id=6809273242" />
        <ScrollViewStyleReset />
        {/* Let the existing client Head replace only its static metadata after hydration. */}
        {Children.map(headNodes, node => {
          if (!isValidElement<{ name?: string; property?: string; rel?: string; 'data-rh'?: boolean }>(node)) return node;
          const { name, property, rel } = node.props;
          const managed = node.type === 'meta' && /^(description|robots|(?:twitter|og|article):.*)$/.test(name ?? property ?? '')
            || node.type === 'link' && (rel === 'canonical' || rel === 'alternate');
          return managed ? cloneElement(node, { 'data-rh': true }) : node;
        })}
        {pathname === '/' && <script data-rh="true" type="application/ld+json">{jsonLd(publicHomeSchema)}</script>}
        {pathname === '/faq' && <script data-rh="true" type="application/ld+json">{jsonLd(publicFaqSchema)}</script>}
      </head>
      <body {...bodyAttributes} style={{ ...bodyAttributes?.style, backgroundColor: WebNightColors.background }}>{children}{bodyNodes}</body>
    </html>
  );
}

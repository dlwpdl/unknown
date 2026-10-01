import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { WebNightColors } from '@/constants/theme';

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="ko" style={{ backgroundColor: WebNightColors.background, colorScheme: 'dark' }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content={WebNightColors.background} />
        <ScrollViewStyleReset />
      </head>
      <body style={{ backgroundColor: WebNightColors.background }}>{children}</body>
    </html>
  );
}

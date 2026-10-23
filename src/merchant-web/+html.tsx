import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { Colors } from '@/constants/theme';

export default function MerchantHtml({ children }: PropsWithChildren) {
  return <html lang="ko" style={{ backgroundColor: Colors.dark.background, colorScheme: 'dark' }}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content={Colors.dark.background} />
      <meta name="robots" content="noindex,nofollow" />
      <meta name="referrer" content="no-referrer" />
      <ScrollViewStyleReset />
    </head>
    <body style={{ backgroundColor: Colors.dark.background }}>{children}</body>
  </html>;
}

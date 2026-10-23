import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { Colors } from '@/constants/theme';

export default function MerchantHtml({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return <html {...htmlAttributes} lang="ko" style={{ ...htmlAttributes?.style, backgroundColor: Colors.dark.background, colorScheme: 'dark' }}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content={Colors.dark.background} />
      <meta name="robots" content="noindex,nofollow" />
      <meta name="referrer" content="no-referrer" />
      <ScrollViewStyleReset />
      {headNodes}
    </head>
    <body {...bodyAttributes} style={{ ...bodyAttributes?.style, backgroundColor: Colors.dark.background }}>{children}{bodyNodes}</body>
  </html>;
}

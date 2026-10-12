import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { ChatMapCommand } from '@/lib/chat-location';

export function ChatMap({ html, command, onEvent }: { html: string; command: ChatMapCommand | null; onEvent: (data: string) => void }) {
  const view = useRef<WebView>(null);
  useEffect(() => {
    if (command) view.current?.injectJavaScript(`window.glingMapCommand?.(${JSON.stringify(command).replace(/</g, '\\u003c')});true;`);
  }, [command]);
  return <WebView ref={view} source={{ html, baseUrl: 'https://gling.ej-entertainment.com/' }} style={{ flex: 1 }}
    originWhitelist={['https://gling.ej-entertainment.com', 'about:blank']} geolocationEnabled={false}
    onMessage={event => onEvent(event.nativeEvent.data)} onError={() => onEvent('{"type":"error"}')}
    onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === 'https://gling.ej-entertainment.com/'} />;
}

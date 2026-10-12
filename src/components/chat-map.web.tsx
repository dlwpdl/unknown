import { useEffect, useRef } from 'react';
import type { ChatMapCommand } from '@/lib/chat-location';

export function ChatMap({ html, command, onEvent }: { html: string; command: ChatMapCommand | null; onEvent: (data: string) => void }) {
  const view = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.source === view.current?.contentWindow && typeof event.data === 'string') onEvent(event.data); };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [onEvent]);
  useEffect(() => {
    if (command) view.current?.contentWindow?.postMessage(command, '*');
  }, [command]);
  const source = html.replace('</script>', `window.addEventListener('message',event=>{if(event.source===window.parent)window.glingMapCommand(event.data);});</script>`);
  return <iframe ref={view} title="공유할 장소 선택 지도" srcDoc={source} sandbox="allow-scripts allow-same-origin" style={{ flex: 1, width: '100%', border: 0 }} />;
}

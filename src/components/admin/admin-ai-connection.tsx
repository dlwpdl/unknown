import { useEffect, useState } from 'react';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function AdminAiConnection() {
  const { play } = useInteractionFeedback();
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/ai-session').then((r) => r.json()).then((s) => { if (active) setConnected(Boolean(s.connected)); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!connected) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        void fetch('/api/ai-session', { method: 'DELETE' }); setConnected(false);
      } else if (event === 'TOKEN_REFRESHED' && session) {
        // The browser retains exclusive ownership of refresh tokens.
        void fetch('/api/ai-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token, continuation: true }),
        }).then((r) => { if (!r.ok) { setConnected(false); setMessage('AI 연결을 다시 열어주세요.'); } }).catch(() => { setConnected(false); });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [connected]);
  async function toggle() {
    if (busy) return;
    play('selection'); setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error('AUTH_REQUIRED');
      const response = await fetch('/api/ai-session', connected ? { method: 'DELETE' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: data.session.access_token }),
      });
      if (!response.ok) throw new Error('MFA_REQUIRED');
      const state = await response.json(); setConnected(Boolean(state.connected)); play('selection');
      setMessage(state.connected ? '이 Mac의 AI와 연결했습니다. 관리자 세션과 연결 권한은 최대 8시간 유효합니다.' : 'AI 연결을 해제했습니다.');
    } catch { setMessage('AI 연결을 열지 못했습니다. 2차 인증과 이 Mac의 관리자 서버 연결을 확인해 주세요.'); play('warning'); }
    finally { setBusy(false); }
  }
  return <div className="merchant-ai"><button type="button" disabled={busy} aria-pressed={connected} onClick={() => void toggle()}>{busy ? '연결 확인 중…' : connected ? 'AI 연결 해제' : 'AI 연결'}</button><small role="status">{message || '벤더 관리 API · 인증한 관리자 세션으로 AI가 작업합니다.'}</small></div>;
}

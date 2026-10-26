import { useEffect, useRef, useState } from 'react';
import { AdminMerchantConnections } from './admin-merchant-connections';
import { loadAdminUserBusinesses, loadMerchant, loadMerchants, MERCHANT_DEFAULT_FILTERS, type AdminUserBusiness as AdminUserBusinessLink, type Merchant } from '@/lib/admin-merchants';
import type { AdminDirectoryProfile } from '@/lib/admin-user-data';
import { MERCHANT_ACCOUNT_ROLES } from '@/lib/merchant-connections';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import './admin-merchants.css';

export function AdminUserBusiness({ account, onChanged }: { account: AdminDirectoryProfile; onChanged: () => void }) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState(''), [results, setResults] = useState<Merchant[] | null>(null);
  const [selected, setSelected] = useState<Merchant | null>(null), [linked, setLinked] = useState<AdminUserBusinessLink[] | null>(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const pending = useRef(false), request = useRef(0), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { let current = true; void loadAdminUserBusinesses(supabase, account.id).then(rows => { if (current) setLinked(rows); }).catch(() => { if (current) setError('비즈니스 연결을 확인하지 못했습니다. 다시 확인해 주세요.'); }); return () => { current = false; }; }, [account.id, revision]);
  async function search() {
    if (pending.current) return;
    const token = ++request.current; pending.current = true; setBusy(true); setError(''); play('selection');
    try { const data = await loadMerchants(supabase, query, 0, { ...MERCHANT_DEFAULT_FILTERS, record_kind: 'business' }); if (active.current && token === request.current) setResults(data.merchants.filter(row => row.record_kind === 'business')); }
    catch { if (active.current && token === request.current) setError('비즈니스를 찾지 못했습니다. 권한과 연결을 확인해 주세요.'); }
    finally { pending.current = false; if (active.current && token === request.current) setBusy(false); }
  }
  async function changed() {
    const token = ++request.current;
    setRevision(value => value + 1); setDirty(false); onChanged();
    if (!selected) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: selected.timezone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    try { const next = await loadMerchant(supabase, selected.id, today.slice(0, 8) + '01', today); if (active.current && token === request.current) setSelected(next.merchant); }
    catch { if (active.current && token === request.current) { setSelected(null); setError('연결은 변경됐지만 최신 비즈니스 정보를 확인하지 못했습니다. 다시 선택해 주세요.'); } }
  }
  return <section className="merchant-admin admin-user-business" aria-label="회원 비즈니스 연결">
    {/* Title and the profile-is-kept note live in the parent card header and its ⓘ. */}
    {linked && <p className="merchant-hint">{linked.length ? linked.map(row => `${row.name} · ${MERCHANT_ACCOUNT_ROLES[row.role]}`).join(' / ') : '연결 없음'}</p>}
    {error && <p role="alert">{error} <button type="button" className="merchant-secondary" disabled={busy} onClick={() => { play('selection'); setError(''); setRevision(value => value + 1); }}>연결 다시 확인</button></p>}
    {selected ? <>
      <button type="button" className="merchant-secondary" disabled={busy} onClick={() => { play('selection'); if (!dirty || window.confirm('저장하지 않은 연결 내용을 닫을까요?')) { request.current++; setSelected(null); setDirty(false); } }}>다른 비즈니스 선택</button>
      <AdminMerchantConnections key={selected.id + ':' + selected.updated_at} merchant={selected} initialAccount={account} busy={busy} onBusy={setBusy} onDirty={setDirty} onChanged={() => { void changed(); }} />
    </> : <>
      <form className="merchant-search" onSubmit={event => { event.preventDefault(); void search(); }}><input aria-label="연결할 비즈니스 검색" value={query} maxLength={120} placeholder="비즈니스 이름·연락처" onFocus={() => play('selection')} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={busy}>{busy ? '검색 중…' : '비즈니스 찾기'}</button></form>
      {results && <div className="merchant-connection-list">{results.map(row => <button key={row.id} type="button" className="merchant-account-result" disabled={busy} onClick={() => { play('selection'); request.current++; setSelected(row); setError(''); }}><strong>{row.name}</strong><span>{row.city_name} · {row.owner_id ? '소유자 연결됨' : '소유자 미연결'}</span></button>)}</div>}
      {results && !results.length && <p role="status">검색 결과가 없습니다. 비즈니스 관리에서 먼저 등록해 주세요.</p>}
    </>}
  </section>;
}

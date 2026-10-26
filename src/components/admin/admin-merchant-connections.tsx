import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { connectAdminMerchantAccount, type Merchant } from '@/lib/admin-merchants';
import { searchAdminUsers, type AdminDirectoryProfile } from '@/lib/admin-user-data';
import {
  MERCHANT_ACCOUNT_ROLES, cancelMerchantAccountInvitation, disconnectMerchantAccount, loadMerchantAccountConnections,
  type MerchantAccountConnection, type MerchantAccountConnections, type MerchantAccountRole,
} from '@/lib/merchant-connections';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { CITIES } from '@/lib/mock';
import { AdminButton, AdminCard } from './admin-ui';

export function AdminMerchantConnections({ merchant, busy: parentBusy, onChanged, onDirty, initialAccount, onBusy }: {
  merchant: Merchant; busy: boolean; onChanged: () => void; onDirty: (dirty: boolean) => void;
  initialAccount?: AdminDirectoryProfile;
  onBusy?: (busy: boolean) => void;
}) {
  const { me, isAdmin } = useAuth(), { play } = useInteractionFeedback();
  const scope = isAdmin ? [me.id, merchant.id, merchant.updated_at].join(':') : '';
  const current = useRef(scope), pending = useRef(false);
  useLayoutEffect(() => { current.current = scope; return () => { current.current = ''; }; }, [scope]);
  const [connections, setConnections] = useState<{ scope: string; data: MerchantAccountConnections } | null>(null);
  const [query, setQuery] = useState(''), [results, setResults] = useState<AdminDirectoryProfile[]>([]);
  const [account, setAccount] = useState<AdminDirectoryProfile | null>(initialAccount ?? null);
  const [role, setRole] = useState<MerchantAccountRole>(merchant.owner_id ? 'operator' : 'owner');
  const [method, setMethod] = useState<'direct' | 'invite'>('direct'), [note, setNote] = useState(''), [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const data = connections?.scope === scope && connections.data.updated_at === merchant.updated_at && scope ? connections.data : null;
  const disabled = parentBusy || busy;
  const noteLength = [...note.trim()].length;
  useEffect(() => {
    let active = true;
    if (scope) void loadMerchantAccountConnections(supabase, merchant.id).then(data => {
      if (active) { setConnections({ scope, data }); setError(''); }
    }).catch(() => { if (active) { setConnections(null); setError('계정 연결을 불러오지 못했습니다. 권한과 2단계 인증을 확인해 주세요.'); } });
    return () => { active = false; };
  }, [scope, merchant.id, revision]);
  async function run(action: () => Promise<unknown>, success: string, changed = false) {
    if (disabled || pending.current || !scope) return;
    pending.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try {
      const session = await supabase.auth.getSession();
      if (current.current !== scope || session.data.session?.user.id !== me.id) return;
      await action();
      if (current.current !== scope) return;
      setNotice(success); play('selection');
      if (changed) { setAccount(initialAccount ?? null); setResults([]); setVerified(false); setNote(''); setAdding(false); onDirty(false); setRevision(v => v + 1); onChanged(); }
    } catch (e) {
      if (current.current !== scope) return;
      play('warning');
      const code = e instanceof Error ? e.message : '';
      setError(({
        MERCHANT_CONNECTION_CHANGED: '비즈니스 정보나 연결이 바뀌었습니다. 새로 확인한 뒤 다시 선택해 주세요.',
        MERCHANT_ACCOUNT_CHANGED: '선택한 회원 정보가 바뀌었습니다. 회원을 다시 검색해 주세요.',
        MERCHANT_OWNER_TRANSFER_REQUIRED: '이미 소유자가 연결돼 있습니다. 기존 연결을 먼저 해제해 주세요.',
        MERCHANT_OWNER_VERIFICATION_REQUIRED: '소유자를 먼저 연결하고 확인해 주세요.',
        MERCHANT_ALREADY_CONNECTED: '이미 연결된 계정입니다.',
        MERCHANT_CONNECTION_CONFIRMATION_REQUIRED: '비즈니스·회원 확인과 확인 기록을 입력해 주세요.',
        ADMIN_REQUIRED: '관리자 2단계 인증을 다시 확인해 주세요.',
      } as Record<string, string>)[code] ?? '처리 결과를 확인하지 못했습니다. 연결 목록을 다시 확인해 주세요.');
      setVerified(false); setAccount(initialAccount ?? null); setResults([]); setConnections(null); setRevision(v => v + 1);
    } finally { pending.current = false; if (current.current === scope) setBusy(false); onBusy?.(false); }
  }
  function change() { setVerified(false); onDirty(true); }
  function disconnect(connection: MerchantAccountConnection) {
    play('warning');
    if (!data || !window.confirm([merchant.name, merchant.address || '주소 미등록', '',
      connection.nickname + ' · ' + (connection.email ?? connection.user_id) + ' · ' + MERCHANT_ACCOUNT_ROLES[connection.role], '',
      '연결을 해제할까요? 비즈니스와 글은 보존됩니다.',
      connection.role === 'owner' ? '운영 담당자 연결과 대기 중인 초대도 해제됩니다.' : '',
    ].join('\n'))) return;
    void run(() => disconnectMerchantAccount(supabase, merchant.id, connection, data.updated_at, '관리자가 선택한 계정 연결을 해제함'), '계정 연결을 해제했습니다.', true);
  }
  if (!isAdmin) return null;
  const row = (connection: MerchantAccountConnection) => <div className="merchant-connection-row" key={connection.role + ':' + connection.user_id}>
    <span><strong>{connection.nickname}</strong><small>{connection.email ?? connection.user_id.slice(-6)}</small></span>
    <button type="button" className="merchant-danger" disabled={disabled} onClick={() => disconnect(connection)}>연결 해제</button>
  </div>;
  return <AdminCard icon="♧" tone="navy" title="계정 연결" count={data ? (data.owner ? 1 : 0) + data.operators.length : undefined}
    info={['비즈니스 프로필은 그대로 두고, 소유자와 운영 담당자의 계정만 연결해요.', '소유자: 비즈니스 전체 관리 · 원가·재고·성과·비공개 후기 포함', '운영 담당자: 비즈니스 프로필·글·사진·초안 관리']}
    action={data && !initialAccount && !adding ? <AdminButton label="연결 추가" disabled={disabled} onPress={() => setAdding(true)} /> : undefined}>
   <section className="merchant-connections" aria-label="계정 연결">
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data ? <button type="button" disabled={disabled} onClick={() => { play('selection'); setRevision(v => v + 1); onChanged(); }}>연결 다시 확인</button> : <>
      <div className="merchant-connection-groups">
        <div className="merchant-connection-group"><h4>소유자</h4>{data.owner ? row(data.owner) : <p className="merchant-hint">아직 연결된 소유자가 없어요. 프로필은 먼저 준비할 수 있어요.</p>}</div>
        <div className="merchant-connection-group"><h4>운영 담당</h4>{data.operators.length ? data.operators.map(row) : <p className="merchant-hint">연결된 운영 담당자가 없어요.</p>}
          {data.invitations.map(invitation => <div className="merchant-connection-row" key={invitation.id}>
            <span><strong>{invitation.nickname}</strong><small>{MERCHANT_ACCOUNT_ROLES[invitation.role]} · 수락 대기 · {new Date(invitation.expires_at).toLocaleDateString('ko-KR')} 만료</small></span>
            <button type="button" disabled={disabled} onClick={() => { play('warning'); if (window.confirm(merchant.name + ' · ' + invitation.nickname + ' 초대를 취소할까요?')) void run(() => cancelMerchantAccountInvitation(supabase, invitation.id), '초대를 취소했습니다.', true); }}>초대 취소</button>
          </div>)}</div>
      </div>
      {!initialAccount && adding && <form onSubmit={e => {
        e.preventDefault(); play('selection'); setAccount(null); setResults([]); setVerified(false);
        void run(async () => {
          const result = await searchAdminUsers(supabase, query);
          if (current.current === scope) setResults(result.rows.filter(row => row.account_status === 'active'));
        }, '검색한 회원을 선택해 주세요.');
      }}><fieldset disabled={disabled}>
        <label>연결할 회원<input maxLength={120} placeholder="닉네임 · 이메일 · 회원 ID" value={query} onFocus={() => play('selection')} onChange={e => { setQuery(e.target.value); setAccount(null); setResults([]); change(); }} /></label>
        <div className="merchant-actions"><button type="submit" disabled={!query.trim()}>회원 검색</button><button type="button" onClick={() => { play('selection'); setAdding(false); setQuery(''); setAccount(null); setResults([]); onDirty(false); }}>취소</button></div>
        {results.map(row => <button type="button" className="merchant-account-result" aria-pressed={account?.id === row.id} key={row.id} onClick={() => { play('selection'); setAccount(row); change(); }}>
          <strong>{row.nickname}</strong><span>{row.email ?? '이메일 없음'} · {CITIES.find(city => city.id === row.city_id)?.name ?? row.city_id} · ID {row.id.slice(-6)}</span>
        </button>)}
      </fieldset></form>}
      {initialAccount && <p className="merchant-hint">선택한 회원 · {initialAccount.nickname} · {initialAccount.email ?? initialAccount.id}</p>}
      {account && (data.owner?.user_id === account.id || data.operators.some(row => row.user_id === account.id)) ? <p role="status">이 회원은 비즈니스에 연결돼 있습니다.</p> : account && <form onSubmit={e => {
        e.preventDefault(); play('warning');
        if (!verified || noteLength < 6 || !window.confirm([merchant.name, merchant.address || '주소 미등록', '', account.nickname,
          account.email ?? '이메일 없음', '회원 ID: ' + account.id, '권한: ' + MERCHANT_ACCOUNT_ROLES[role],
          '방식: ' + (method === 'direct' ? '수락 없이 바로 연결' : '회원 수락 후 연결'), '', '이 비즈니스와 계정을 연결할까요?',
        ].join('\n'))) return;
        void run(() => connectAdminMerchantAccount(supabase, merchant, account, { role, method, verified, note }),
          method === 'direct' ? '계정을 바로 연결했습니다.' : '해당 회원에게 수락 대기 중인 초대를 만들었습니다.', true);
      }}><fieldset disabled={disabled}>
        <div className="merchant-fields"><label>권한<select value={role} onChange={e => { play('selection'); setRole(e.target.value as MerchantAccountRole); change(); }}>
          <option value="owner" disabled={!!data.owner}>소유자</option><option value="operator" disabled={!data.owner}>운영 담당자</option>
        </select></label><label>연결 방식<select value={method} onChange={e => { play('selection'); setMethod(e.target.value as 'direct' | 'invite'); change(); }}>
          <option value="direct">바로 연결</option><option value="invite">초대 후 수락</option>
        </select></label></div>
        <div className="merchant-connection-review"><strong>{merchant.name}</strong><span>{merchant.address || '주소 미등록'} · {merchant.city_name}</span><strong>{account.nickname} · {account.email ?? account.id}</strong><span>{MERCHANT_ACCOUNT_ROLES[role]} · {method === 'direct' ? '즉시 연결' : '수락 후 연결'}</span></div>
        <label>확인 기록 (6자 이상)<textarea required minLength={6} maxLength={3000} rows={2} placeholder="비즈니스 담당자와 확인한 날짜와 방법" value={note} onFocus={() => play('selection')} onChange={e => { setNote(e.target.value); change(); }} /></label>
        <p className="merchant-hint" role="status">확인 기록 {noteLength}자 · {noteLength < 6 ? '6자 이상 입력해야 연결할 수 있습니다.' : '입력 조건을 충족했습니다.'}</p>
        <label className="merchant-owner-check"><input type="checkbox" checked={verified} onChange={e => { play('selection'); setVerified(e.target.checked); onDirty(true); }} />위 비즈니스와 회원, 관리 권한을 직접 확인했습니다.</label>
        <button className="merchant-primary" type="submit" disabled={!verified || noteLength < 6}>{busy ? '처리 중…' : method === 'direct' ? '바로 연결' : '초대 보내기'}</button>
      </fieldset></form>}
    </>}
   </section>
  </AdminCard>;
}

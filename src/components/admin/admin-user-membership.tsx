import { useEffect, useRef, useState } from 'react';
import {
  GRANT_TIERS, MEMBERSHIP_ERRORS, MEMBERSHIP_SOURCE_LABELS, MEMBERSHIP_TIER_LABELS, clearAdminMembership, loadAdminMembership, membershipEndDate, setAdminMembership,
  type AdminMembership, type AdminMembershipState, type GrantTier,
} from '@/lib/admin-membership';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import './admin-merchants.css';

const day = (value: string | null) => value ? new Date(value).toLocaleDateString('ko-KR') : '';
const tierName = (tier: string) => MEMBERSHIP_TIER_LABELS[tier] ?? tier;

function Current({ value }: { value: AdminMembershipState }) {
  return <p className="merchant-hint" role="status">
    지금 적용: <strong>{tierName(value.tier)}</strong> · {MEMBERSHIP_SOURCE_LABELS[value.source]}
    {value.expires_at && value.source !== 'operator' ? ` · ${day(value.expires_at)}까지` : ''}
    {value.will_renew ? ' · 자동 결제로 갱신 중' : ''}
    {value.grant && <><br />관리자 지급: {tierName(value.grant.tier)} · {day(value.grant.expires_at)}까지{value.grant.active ? '' : ' (끝남)'}
      {value.grant.created_by ? ` · ${value.grant.created_by}님이 ${day(value.grant.created_at)}에 지급` : ''}
      {value.grant.active && value.tier !== value.grant.tier ? ' · 더 높은 등급이 있어 그쪽이 적용돼요' : ''}</>}
  </p>;
}

function GrantForm({ label, value, blocked, busy, onSave, onClear }: {
  label: string; value: AdminMembershipState; blocked?: string; busy: boolean;
  onSave: (tier: GrantTier, endsOn: string, note: string) => void; onClear: (note: string) => void;
}) {
  const { play } = useInteractionFeedback();
  const [tier, setTier] = useState<GrantTier>(value.grant?.tier ?? 'plus');
  const [endsOn, setEndsOn] = useState(value.grant?.active ? membershipEndDate(0, new Date(value.grant.expires_at)) : membershipEndDate(30));
  const [note, setNote] = useState('');
  if (value.source === 'operator') return <p className="merchant-hint">운영자 계정은 이미 제한이 없어 따로 지급하지 않아요.</p>;
  if (blocked) return <p className="merchant-hint">{blocked}</p>;
  return <form onSubmit={event => {
    event.preventDefault(); play('warning');
    if (window.confirm(`${label}\n\n${tierName(tier)} 등급을 ${endsOn}까지 지급할까요?\n자동으로 결제되거나 갱신되지 않아요.`)) onSave(tier, endsOn, note);
  }}><fieldset disabled={busy}>
    <div className="merchant-fields">
      <label>등급<select value={tier} onChange={event => { play('selection'); setTier(event.target.value as GrantTier); }}>
        {GRANT_TIERS.map(option => <option key={option} value={option}>{tierName(option)}</option>)}
      </select></label>
      <label>끝나는 날 (이날 밤까지)<input type="date" required value={endsOn} min={membershipEndDate(0)} max={membershipEndDate(365 * 3)} onFocus={() => play('selection')} onChange={event => setEndsOn(event.target.value)} /></label>
    </div>
    <label>메모 (선택)<input maxLength={500} placeholder="예: 오픈 이벤트, 협업 감사" value={note} onFocus={() => play('selection')} onChange={event => setNote(event.target.value)} /></label>
    <div className="merchant-actions">
      <button type="submit" className="merchant-primary" disabled={!endsOn}>{busy ? '저장 중…' : value.grant ? '지급 내용 바꾸기' : '지급하기'}</button>
      {value.grant && <button type="button" className="merchant-danger" onClick={() => {
        play('warning');
        if (window.confirm(`${label}\n\n관리자 지급을 해제할까요? 스토어 결제나 초대 이용권은 그대로 남아요.`)) onClear(note);
      }}>지급 해제</button>}
    </div>
  </fieldset></form>;
}

export function AdminUserMembership({ userId, active }: { userId: string; active: boolean }) {
  const [data, setData] = useState<AdminMembership | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const pending = useRef(false), { play } = useInteractionFeedback();
  useEffect(() => {
    let current = true;
    void loadAdminMembership(supabase, userId).then(value => { if (current) { setData(value); setError(''); } })
      .catch(() => { if (current) setError('멤버십을 불러오지 못했어요. 관리자 2단계 인증과 연결을 확인해 주세요.'); });
    return () => { current = false; };
  }, [userId, revision]);
  async function run(action: () => Promise<AdminMembership>, success: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { setData(await action()); setNotice(success); play('selection'); }
    catch (e) { play('warning'); setError(MEMBERSHIP_ERRORS[e instanceof Error ? e.message : ''] ?? '저장 결과를 확인하지 못했어요. 새로 불러와 확인해 주세요.'); setRevision(v => v + 1); }
    finally { pending.current = false; setBusy(false); }
  }
  const save = (merchantId: string | null, tier: GrantTier, endsOn: string, note: string) =>
    void run(() => setAdminMembership(supabase, userId, merchantId, tier, endsOn, note), `${tierName(tier)} 등급을 ${endsOn}까지 지급했어요.`);
  const clear = (merchantId: string | null, note: string) =>
    void run(() => clearAdminMembership(supabase, userId, merchantId, note), '관리자 지급을 해제했어요.');
  return <section className="merchant-admin admin-user-membership" aria-label="멤버십 변경">
    {error && <p role="alert">{error} <button type="button" className="merchant-secondary" disabled={busy} onClick={() => { play('selection'); setRevision(v => v + 1); }}>다시 불러오기</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? !error && <p className="merchant-hint">불러오는 중…</p> : <>
      <h4>개인 멤버십</h4>
      <Current value={data.personal} />
      {active ? <GrantForm key={'p:' + (data.personal.grant?.created_at ?? '')} label="개인 멤버십" value={data.personal} busy={busy} onSave={(tier, endsOn, note) => save(null, tier, endsOn, note)} onClear={note => clear(null, note)} />
        : <p className="merchant-hint">이용 중인 회원에게만 지급할 수 있어요.</p>}
      {data.businesses.map(row => <div key={row.merchant_id}>
        <h4>비즈니스 멤버십 · {row.name}</h4>
        <Current value={row} />
        {active && <GrantForm key={row.merchant_id + ':' + (row.grant?.created_at ?? '')} label={`${row.name} 비즈니스 멤버십`} value={row} busy={busy}
          blocked={!row.owner_verified ? '비즈니스 소유 확인을 먼저 하면 지급할 수 있어요. (비즈니스 관리 → 계정 관리)'
            : row.bound_elsewhere ? MEMBERSHIP_ERRORS.BUSINESS_SUBSCRIPTION_BOUND : undefined}
          onSave={(tier, endsOn, note) => save(row.merchant_id, tier, endsOn, note)} onClear={note => clear(row.merchant_id, note)} />}
      </div>)}
      {!data.businesses.length && <p className="merchant-hint">이 회원이 소유자로 연결된 비즈니스가 없어요. 비즈니스 멤버십은 소유자로 연결한 뒤 지급할 수 있어요.</p>}
      {!!data.history.length && <details><summary>변경 기록 {data.history.length}건</summary><ul>
        {data.history.map(row => <li key={row.id} className="merchant-hint">
          {new Date(row.created_at).toLocaleString('ko-KR')} · {row.kind === 'business' ? `비즈니스(${row.merchant_name ?? '삭제됨'})` : '개인'} · {row.tier ? `${tierName(row.tier)} ${day(row.expires_at)}까지 지급` : '지급 해제'} · {row.created_by ?? '알 수 없음'}{row.note ? ` · ${row.note}` : ''}
        </li>)}
      </ul></details>}
    </>}
  </section>;
}

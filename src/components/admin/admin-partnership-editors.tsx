import { useEffect, useRef, useState } from 'react';

import { loadMerchants } from '@/lib/admin-merchants';
import {
  amountToCents, actBenefitCoupon, issueBenefitCoupon, loadPartnerships, savePartnership, partnershipError,
  BENEFIT_STATUSES, CAMPAIGN_STATUSES, CREATOR_STATUSES, PARTICIPATION_STAGES, PAYMENT_STATUSES,
  type Benefit, type BenefitCoupon, type PartnershipKind,
} from '@/lib/admin-partnerships';
import { searchAdminUsers } from '@/lib/admin-user-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { safeMerchantSourceUrl } from '@/lib/merchant-source';
import { supabase } from '@/lib/supabase';

export type PartnershipEditorState = { kind: PartnershipKind; record: { id: string } & Record<string, unknown>; revision: string | null };
type Callbacks = { onSaved: (id: string) => void | Promise<void>; onCancel: () => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void };
type PickKind = 'merchant' | 'member' | 'creator' | 'campaign';
const fields: Record<PartnershipKind, string[]> = {
  creator: ['id', 'member_id', 'display_name', 'city_id', 'profile_url', 'category', 'contact', 'reference_url', 'reference_views', 'metrics_note', 'status', 'notes'],
  campaign: ['id', 'merchant_id', 'title', 'status', 'terms', 'terms_confirmed', 'team_limit', 'minimum_views', 'support_amount_cents', 'currency', 'deadline_note', 'ends_on', 'notes'],
  benefit: ['id', 'merchant_id', 'campaign_id', 'title', 'audience', 'status', 'discount_percent', 'terms', 'terms_confirmed', 'expires_on', 'issue_limit'],
  participation: ['id', 'campaign_id', 'creator_id', 'stage', 'scheduled_at', 'visited_at', 'content_url', 'actual_views', 'payment_status', 'payment_note', 'notes'],
};

function useSave(callbacks: Callbacks) {
  const { play } = useInteractionFeedback();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef(false), alive = useRef(true), savedId = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(action: () => Promise<string>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); callbacks.onBusy(true); play('selection');
    try {
      const id = savedId.current ?? await action(); savedId.current = id;
      if (alive.current) { setAcknowledged(true); await callbacks.onSaved(id); if (alive.current) { callbacks.onDirty(false); play('selection'); } }
    }
    catch (reason) { if (alive.current) { setError(partnershipError(savedId.current ? new Error('PARTNERSHIP_READBACK_REQUIRED') : reason)); play('warning'); } }
    finally { pending.current = false; if (alive.current) setBusy(false); callbacks.onBusy(false); }
  }
  return { error, busy, acknowledged, save };
}

function EntityPicker({ type, value, label, selectedLabel, onPick, disabled, optional = false, locked = false }: {
  type: PickKind; value: string; label: string; selectedLabel: string; onPick: (id: string | null, name: string) => void;
  disabled?: boolean; optional?: boolean; locked?: boolean;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState(''), [results, setResults] = useState<{ id: string; name: string; hint: string }[] | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  async function search() {
    const token = ++request.current;
    setLoading(true); setError(''); play('selection');
    try {
      let next: { id: string; name: string; hint: string }[];
      if (type === 'merchant') {
        const data = await loadMerchants(supabase, query.trim());
        next = data.merchants.filter((row) => row.record_kind === 'business').map((row) => ({ id: row.id, name: row.name, hint: row.city_name }));
      } else if (type === 'member') {
        const data = await searchAdminUsers(supabase, query.trim());
        next = data.rows.filter((row) => row.account_status === 'active').map((row) => ({ id: row.id, name: row.nickname, hint: CITIES.find((city) => city.id === row.city_id)?.name ?? '' }));
      } else {
        const data = await loadPartnerships(supabase, type === 'creator' ? 'creators' : 'campaigns', query.trim());
        next = data.rows.map((row) => ({ id: row.id, name: 'display_name' in row ? row.display_name : row.title, hint: 'display_name' in row ? row.city_name : row.merchant_name }));
      }
      if (request.current === token) setResults(next.slice(0, 20));
    } catch (reason) { if (request.current === token) setError(partnershipError(reason)); }
    finally { if (request.current === token) setLoading(false); }
  }
  return <section className="partnership-picker" aria-label={label}>
    <div className="partnership-picker-selection"><div><h3>{label}{optional ? ' · 선택' : ''}</h3><p className="partnership-muted">{value ? selectedLabel || '연결된 대상' : optional ? '연결하지 않음' : '이름으로 검색해서 선택해 주세요.'}</p></div>
      {value && !locked && <button type="button" disabled={disabled} onClick={() => { play('selection'); onPick(null, ''); setResults(null); }}>{optional ? '연결 해제' : '다시 선택'}</button>}</div>
    {!locked && !value && <><div className="partnership-picker-search"><input type="search" aria-label={`${label} 검색어`} placeholder="이름으로 검색" value={query} maxLength={200} disabled={disabled} onFocus={() => play('selection')} onChange={(event) => { request.current++; setLoading(false); setQuery(event.target.value); setResults(null); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} /><button type="button" disabled={disabled || loading} onClick={() => void search()}>{loading ? '검색 중' : '찾기'}</button></div>
      {error && <p role="alert">{error}</p>}
      {results && <><ul className="partnership-picker-results">{results.map((row) => <li key={row.id}><button type="button" disabled={disabled} onClick={() => { play('selection'); onPick(row.id, row.name); setResults(null); }}>{row.name}{row.hint ? ` · ${row.hint}` : ''}</button></li>)}</ul><p className="partnership-muted">{results.length ? '최대 20개를 표시합니다. 찾는 이름을 구체적으로 입력해 주세요.' : '검색 결과가 없습니다.'}</p></>}
    </>}
  </section>;
}

const localTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T') : '';
const optionalInteger = (value: unknown) => value == null || value === '' ? null : Number(value);

export function PartnershipEditor({ state, ...callbacks }: { state: PartnershipEditorState } & Callbacks) {
  const { play } = useInteractionFeedback();
  const [data, setData] = useState<Record<string, unknown>>(() => ({
    ...(state.kind === 'creator' ? { display_name: '', city_id: 'vancouver', profile_url: '', category: '', contact: '', reference_url: '', reference_views: null, metrics_note: '', member_id: null, status: 'active', notes: '' }
      : state.kind === 'campaign' ? { merchant_id: null, title: '', status: 'draft', terms: '', terms_confirmed: false, team_limit: null, minimum_views: null, support_amount_cents: null, currency: null, deadline_note: '', ends_on: null, notes: '' }
        : state.kind === 'benefit' ? { merchant_id: null, campaign_id: null, title: '', audience: 'creators', status: 'draft', discount_percent: null, terms: '', terms_confirmed: false, expires_on: null, issue_limit: null }
          : { campaign_id: null, creator_id: null, stage: 'applied', scheduled_at: null, visited_at: null, content_url: '', actual_views: null, payment_status: 'not_applicable', payment_note: '', notes: '' }),
    ...state.record,
  }));
  const [amount, setAmount] = useState(state.record.support_amount_cents == null ? '' : (Number(state.record.support_amount_cents) / 100).toFixed(2));
  const action = useSave(callbacks);
  const value = (field: string) => data[field] == null ? '' : String(data[field]);
  const change = (field: string, next: unknown) => { setData((current) => ({ ...current, [field]: next })); callbacks.onDirty(true); };
  function pick(field: string, nameField: string, next: string | null, name: string) {
    setData((current) => ({ ...current, [field]: next, [nameField]: name })); callbacks.onDirty(true);
  }
  async function submit() {
    const record = Object.fromEntries(fields[state.kind].map((field) => [field, data[field] ?? null])) as { id: string } & Record<string, unknown>;
    for (const field of ['reference_views', 'team_limit', 'minimum_views', 'discount_percent', 'issue_limit', 'actual_views']) {
      if (field in record) { record[field] = optionalInteger(record[field]); if (record[field] !== null && (!Number.isInteger(record[field]) || Number(record[field]) < 0)) throw new Error('INVALID_PARTNERSHIP'); }
    }
    for (const field of ['profile_url', 'reference_url', 'content_url']) {
      if (field in record) {
        const source = String(record[field] ?? '').trim();
        if (source && !safeMerchantSourceUrl(source)) throw new Error('INVALID_PARTNERSHIP');
        record[field] = source ? safeMerchantSourceUrl(source) : '';
      }
    }
    for (const field of ['member_id', 'merchant_id', 'campaign_id', 'creator_id', 'currency', 'ends_on', 'expires_on']) if (field in record && !record[field]) record[field] = null;
    for (const field of ['scheduled_at', 'visited_at']) if (field in record) record[field] = record[field] ? new Date(String(record[field])).toISOString() : null;
    if (state.kind === 'campaign') record.support_amount_cents = amountToCents(amount);
    if (state.kind === 'participation' && record.payment_status === 'paid' && state.record.payment_status !== 'paid'
      && !window.confirm('실제로 지급한 지원금의 확인 기록을 저장할까요? 송금은 실행되지 않습니다.')) throw new Error('PARTNERSHIP_STAGE');
    return savePartnership(supabase, state.kind, record, state.revision);
  }
  const merchantPicker = <EntityPicker type="merchant" value={value('merchant_id')} selectedLabel={value('merchant_name')} label="업체" locked={Boolean(state.revision)} disabled={action.busy} onPick={(next, name) => pick('merchant_id', 'merchant_name', next, name)} />;
  const terms = <><label>제공 조건·확인할 내용<textarea value={value('terms')} maxLength={3000} required={Boolean(data.terms_confirmed)} onChange={(event) => change('terms', event.target.value)} /></label><label className="partnership-check"><input type="checkbox" checked={Boolean(data.terms_confirmed)} onChange={(event) => { play('selection'); change('terms_confirmed', event.target.checked); }} />업체와 대상·제공 조건·기한을 확인했습니다.</label></>;
  return <form className="partnership-form" onSubmit={(event) => { event.preventDefault(); void action.save(submit); }}>
    {action.error && <p role="alert" className="partnership-form-error">{action.error}</p>}
    <fieldset disabled={action.busy || action.acknowledged} className="partnership-form">
      {state.kind === 'creator' ? <>
        <div className="partnership-form-grid"><label>크리에이터 이름<input required maxLength={120} value={value('display_name')} onChange={(event) => change('display_name', event.target.value)} /></label><label>활동 지역<select value={value('city_id')} onChange={(event) => { play('selection'); change('city_id', event.target.value); }}>{CITIES.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label><label>SNS 프로필 주소<input type="url" required maxLength={2048} placeholder="https://www.instagram.com/..." value={value('profile_url')} onChange={(event) => change('profile_url', event.target.value)} /></label><label>콘텐츠 분야<input maxLength={80} placeholder="맛집 · 라이프 · 여행" value={value('category')} onChange={(event) => change('category', event.target.value)} /></label></div>
        <label>연락 경로<input maxLength={1000} placeholder="본인이 제공한 연락 방법" value={value('contact')} onChange={(event) => change('contact', event.target.value)} /></label>
        <EntityPicker type="member" value={value('member_id')} selectedLabel={value('member_name')} label="글링 회원 연결" optional disabled={action.busy} onPick={(next, name) => pick('member_id', 'member_name', next, name)} />
        <fieldset className="partnership-form"><legend>참고 성과</legend><div className="partnership-form-grid"><label>확인한 콘텐츠 주소<input type="url" maxLength={2048} value={value('reference_url')} onChange={(event) => change('reference_url', event.target.value)} /></label><label>해당 콘텐츠 조회수<input type="number" min="0" max="2147483647" step="1" value={value('reference_views')} onChange={(event) => change('reference_views', event.target.value)} /></label></div><label>확인 시점·출처 메모<textarea maxLength={1000} placeholder="어떤 콘텐츠의 수치를 언제 확인했는지 기록해 주세요." value={value('metrics_note')} onChange={(event) => change('metrics_note', event.target.value)} /></label><p className="partnership-muted">직접 입력하는 참고 수치입니다. SNS 계정 소유나 앞으로의 조회수를 보증하지 않습니다.</p></fieldset>
        <label>관리 상태<select value={value('status')} onChange={(event) => { play('selection'); change('status', event.target.value); }}>{Object.entries(CREATOR_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </> : state.kind === 'campaign' ? <>
        {merchantPicker}<label>캠페인 이름<input required maxLength={160} value={value('title')} onChange={(event) => change('title', event.target.value)} /></label>
        <div className="partnership-form-grid"><label>관리 상태<select value={value('status')} onChange={(event) => { play('selection'); change('status', event.target.value); }}>{Object.entries(CAMPAIGN_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>지원·선정 정원 (팀)<input type="number" min="1" max="10000" step="1" value={value('team_limit')} onChange={(event) => change('team_limit', event.target.value)} /></label><label>종료일<input type="date" value={value('ends_on')} onChange={(event) => change('ends_on', event.target.value)} /></label><label>전달받은 일정<input maxLength={300} placeholder="예: 11월까지 · 정확한 날짜 확인 중" value={value('deadline_note')} onChange={(event) => change('deadline_note', event.target.value)} /></label><label>지원 제안액<input type="text" inputMode="decimal" placeholder="예: 150.00" maxLength={12} value={amount} onChange={(event) => { setAmount(event.target.value); callbacks.onDirty(true); }} /></label><label>지원 통화<select value={value('currency')} onChange={(event) => { play('selection'); change('currency', event.target.value || null); }}><option value="">미확정</option><option value="CAD">CAD</option><option value="USD">USD</option></select></label><label>지원 자격 참고 조회수<input type="number" min="0" max="2147483647" step="1" value={value('minimum_views')} onChange={(event) => change('minimum_views', event.target.value)} /></label></div>
        {terms}<p className="partnership-muted">지원 제안액의 팀당 여부·지급 방식은 조건에 기록해 주세요. 조건과 기한이 미확정이면 제안·준비 상태로 저장합니다.</p>
      </> : state.kind === 'benefit' ? <>
        {merchantPicker}<label>혜택 이름<input required maxLength={160} value={value('title')} onChange={(event) => change('title', event.target.value)} /></label>
        <div className="partnership-form-grid"><label>혜택 대상<select value={value('audience')} onChange={(event) => { play('selection'); change('audience', event.target.value); }}>{[['creators','크리에이터'],['members','일반 회원']].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>관리 상태<select value={value('status')} onChange={(event) => { play('selection'); change('status', event.target.value); }}>{Object.entries(BENEFIT_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>할인율 (%) · 선택<input type="number" min="1" max="100" step="1" value={value('discount_percent')} onChange={(event) => change('discount_percent', event.target.value)} /></label><label>쿠폰 유효기한<input type="date" value={value('expires_on')} onChange={(event) => change('expires_on', event.target.value)} /></label><label>전체 발급 한도 · 선택<input type="number" min="1" max="10000" step="1" value={value('issue_limit')} onChange={(event) => change('issue_limit', event.target.value)} /></label></div>
        <EntityPicker type="campaign" value={value('campaign_id')} selectedLabel={value('campaign_title')} label="연결할 협업 캠페인" optional locked={Boolean(state.revision)} disabled={action.busy} onPick={(next, name) => pick('campaign_id', 'campaign_title', next, name)} />
        {terms}<p className="partnership-muted">일반 회원 혜택은 크리에이터 협업과 별도로 정합니다. 쿠폰을 발급한 뒤에는 대상과 제공 조건을 바꿀 수 없습니다.</p>
      </> : <>
        <EntityPicker type="campaign" value={value('campaign_id')} selectedLabel={value('campaign_title')} label="협업 캠페인" locked={Boolean(state.revision)} disabled={action.busy} onPick={(next, name) => pick('campaign_id', 'campaign_title', next, name)} />
        <EntityPicker type="creator" value={value('creator_id')} selectedLabel={value('creator_name')} label="담당 크리에이터 · 한 팀" locked={Boolean(state.revision)} disabled={action.busy} onPick={(next, name) => pick('creator_id', 'creator_name', next, name)} />
        <div className="partnership-form-grid"><label>진행 단계<select value={value('stage')} onChange={(event) => { play('selection'); change('stage', event.target.value); }}>{Object.entries(PARTICIPATION_STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>방문 예정 · 현재 기기 시간<input type="datetime-local" value={localTime(data.scheduled_at)} onChange={(event) => change('scheduled_at', event.target.value)} /></label><label>실제 방문 확인 · 현재 기기 시간<input type="datetime-local" value={localTime(data.visited_at)} onChange={(event) => change('visited_at', event.target.value)} /></label><label>제출 콘텐츠 주소<input type="url" maxLength={2048} value={value('content_url')} onChange={(event) => change('content_url', event.target.value)} /></label><label>콘텐츠 조회수 · 직접 확인값<input type="number" min="0" max="2147483647" step="1" value={value('actual_views')} onChange={(event) => change('actual_views', event.target.value)} /></label><label>지원금 처리 기록<select value={value('payment_status')} onChange={(event) => { play('selection'); change('payment_status', event.target.value); }}>{Object.entries(PAYMENT_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <label>지원금 지급 확인 메모<textarea maxLength={1000} value={value('payment_note')} placeholder="실제 지급한 날짜·금액·확인 근거" onChange={(event) => change('payment_note', event.target.value)} /></label><p className="partnership-muted">지급 사실을 기록합니다. 이 화면에서 송금하지 않습니다.</p>
      </>}
      {state.kind !== 'benefit' && <label>운영 메모<textarea maxLength={3000} value={value('notes')} onChange={(event) => change('notes', event.target.value)} /></label>}
    </fieldset>
    {action.acknowledged && <p className="partnership-muted">저장 요청을 다시 보내지 않고, 저장된 내용만 조회합니다.</p>}
    <div className="partnership-form-actions"><button type="button" disabled={action.busy} onClick={callbacks.onCancel}>돌아가기</button><button type="submit" className="partnership-primary" disabled={action.busy}>{action.busy ? action.acknowledged ? '내용 확인 중…' : '저장 중…' : action.acknowledged ? '저장 내용 다시 확인' : '저장'}</button></div>
  </form>;
}

export function CouponIssueForm({ requestId, benefit, ...callbacks }: { requestId: string; benefit: Benefit } & Callbacks) {
  const [recipient, setRecipient] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [confirmed, setConfirmed] = useState(false);
  const { play } = useInteractionFeedback();
  const action = useSave(callbacks);
  return <form className="partnership-form" onSubmit={(event) => { event.preventDefault(); void action.save(async () => {
    if (!confirmed || !recipient.id) throw new Error('INVALID_PARTNERSHIP');
    return issueBenefitCoupon(supabase, requestId, benefit.id, { creator_id: benefit.audience === 'creators' ? recipient.id : null, user_id: benefit.audience === 'members' ? recipient.id : null });
  }); }}>
    <div><h3>{benefit.title}</h3><p>{benefit.merchant_name} · {benefit.expires_on}까지</p><p className="partnership-copy">{benefit.terms}</p></div>
    {action.error && <p role="alert" className="partnership-form-error">{action.error}</p>}
    <EntityPicker type={benefit.audience === 'creators' ? 'creator' : 'member'} value={recipient.id ?? ''} selectedLabel={recipient.name} label="쿠폰을 받을 대상" disabled={action.busy || action.acknowledged} onPick={(id, name) => { setRecipient({ id, name }); setConfirmed(false); callbacks.onDirty(true); }} />
    {benefit.campaign_id && <p className="partnership-muted">연결 캠페인에서 선정된 팀의 크리에이터에게만 발급할 수 있습니다.</p>}
    <label className="partnership-check"><input type="checkbox" checked={confirmed} disabled={action.busy || action.acknowledged} onChange={(event) => { play('selection'); setConfirmed(event.target.checked); callbacks.onDirty(true); }} />수령 대상과 제공 조건을 확인했습니다.</label>
    {action.acknowledged && <p className="partnership-muted">쿠폰을 다시 발급하지 않고, 발급 내역만 조회합니다.</p>}
    <div className="partnership-form-actions"><button type="button" disabled={action.busy} onClick={callbacks.onCancel}>돌아가기</button><button type="submit" className="partnership-primary" disabled={action.busy || !confirmed || !recipient.id}>{action.busy ? action.acknowledged ? '내용 확인 중…' : '발급 중…' : action.acknowledged ? '저장 내용 다시 확인' : '쿠폰 발급'}</button></div>
  </form>;
}

export function CouponActionForm({ coupon, action: couponAction, ...callbacks }: { coupon: BenefitCoupon; action: 'redeem' | 'revoke' } & Callbacks) {
  const [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false);
  const { play } = useInteractionFeedback();
  const action = useSave(callbacks);
  return <form className="partnership-form" onSubmit={(event) => { event.preventDefault(); void action.save(async () => {
    if (!confirmed) throw new Error('INVALID_PARTNERSHIP');
    return actBenefitCoupon(supabase, coupon.id, coupon.updated_at, couponAction, note);
  }); }}>
    <div><h3>{coupon.recipient_name}</h3><p>{coupon.benefit_title} · {coupon.merchant_name}</p><p className="partnership-code">{coupon.code}</p></div>
    {action.error && <p role="alert" className="partnership-form-error">{action.error}</p>}
    <label>확인 내용<textarea required maxLength={1000} value={note} disabled={action.busy || action.acknowledged} placeholder={couponAction === 'redeem' ? '매장 방문과 혜택 적용을 확인한 내용을 남겨 주세요.' : '쿠폰을 취소하는 이유를 남겨 주세요.'} onChange={(event) => { setNote(event.target.value); callbacks.onDirty(true); }} /></label>
    <label className="partnership-check"><input type="checkbox" checked={confirmed} disabled={action.busy || action.acknowledged} onChange={(event) => { play('selection'); setConfirmed(event.target.checked); callbacks.onDirty(true); }} />{couponAction === 'redeem' ? '실제 사용을 확인했으며 다시 사용할 수 없도록 처리합니다.' : '이 쿠폰을 더 이상 사용할 수 없도록 취소합니다.'}</label>
    {action.acknowledged && <p className="partnership-muted">쿠폰 상태를 다시 변경하지 않고, 처리 내역만 조회합니다.</p>}
    <div className="partnership-form-actions"><button type="button" disabled={action.busy} onClick={callbacks.onCancel}>돌아가기</button><button type="submit" className="partnership-primary" disabled={action.busy || !confirmed || !note.trim()}>{action.busy ? action.acknowledged ? '내용 확인 중…' : '처리 중…' : action.acknowledged ? '저장 내용 다시 확인' : couponAction === 'redeem' ? '사용 완료로 기록' : '쿠폰 취소'}</button></div>
  </form>;
}

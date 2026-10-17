import { useEffect, useState } from 'react';
import { CreatorDealForm, CreatorDealMerchantForm, EntityPicker } from './admin-partnership-editors';
import { creatorDealAmount, loadCreatorDeal, loadMerchantCreatorDeals, loadPartnerships, partnershipError, type Creator, type CreatorDeal, type MerchantCreatorDeal, type PartnershipPage } from '@/lib/admin-partnerships';
import { merchantEventId } from '@/lib/merchant-source';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import './admin-partnerships.css';

export function AdminMerchantCreators({ merchant, onDirty, onBusy }: { merchant: { id: string; name: string }; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const { play } = useInteractionFeedback();
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: MerchantCreatorDeal[]; more: boolean } | null>(null);
  const [chosen, setChosen] = useState<{ id: string | null; name: string } | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0), [history, setHistory] = useState<{ key: string; page: PartnershipPage } | null>(null);
  const [form, setForm] = useState<{ creator: Creator; requestId: string } | { deal: CreatorDeal } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const key = `${merchant.id}:${offset}:${revision}`, historyKey = `${chosen?.id}:${historyOffset}:${revision}`;
  const current = result?.key === key ? result : null, picked = history?.key === historyKey ? history.page : null;
  const error = failure?.key === key || failure?.key === historyKey ? failure.message : '';
  useEffect(() => { let active = true; void loadMerchantCreatorDeals(supabase, merchant.id, offset).then(data => { if (active) setResult({ key, ...data }); }).catch(e => { if (active) setFailure({ key, message: partnershipError(e) }); }); return () => { active = false; }; }, [key, merchant.id, offset]);
  useEffect(() => { if (!chosen?.id) return; let active = true; void loadPartnerships(supabase, 'creators', '', 0, chosen.id, historyOffset, { sort: 'date_desc', currency: 'CAD' }).then(page => { if (active) setHistory({ key: historyKey, page }); }).catch(e => { if (active) setFailure({ key: historyKey, message: partnershipError(e) }); }); return () => { active = false; }; }, [historyKey, chosen?.id, historyOffset]);
  function changeDirty(value: boolean) { setDirty(value); onDirty(value); }
  function changeBusy(value: boolean) { setBusy(value); onBusy(value); }
  function cancel() { if (busy || dirty && !window.confirm('저장하지 않은 연결 내용을 닫을까요?')) return; play('selection'); setChosen(null); setForm(null); changeDirty(false); }
  async function saved(id: string) {
    const deal = await loadCreatorDeal(supabase, id);
    if (deal.merchant_id !== merchant.id) throw new Error('PARTNERSHIP_READBACK_REQUIRED');
    const data = await loadMerchantCreatorDeals(supabase, merchant.id, 0);
    setOffset(0); setResult({ key: `${merchant.id}:0:${revision + 1}`, ...data }); setRevision(value => value + 1);
    setForm(null); setChosen(null); changeDirty(false); setNotice('이 벤더에 연결된 협업 이력을 확인했습니다.');
  }
  const callbacks = { onSaved: saved, onCancel: cancel, onDirty: changeDirty, onBusy: changeBusy };
  const creator = picked?.record && 'display_name' in picked.record ? picked.record : null;
  return <section className="merchant-creators partnership-admin" aria-label="벤더 크리에이터 협업">
    <div className="partnership-section-heading"><div><h2>크리에이터 협업</h2><p className="partnership-muted">{merchant.name}과 연결된 같은 협업 이력입니다. 날짜는 예정일을 포함합니다.</p></div>{!chosen && !form && <button type="button" className="partnership-primary" onClick={() => { play('selection'); setChosen({ id: null, name: '' }); setHistoryOffset(0); setNotice(''); }}>크리에이터 연결</button>}</div>
    {notice && <p role="status" className="partnership-notice">{notice}</p>}
    {error && <p role="alert">{error}<button type="button" disabled={busy} onClick={() => { play('selection'); setRevision(value => value + 1); }}>다시 불러오기</button></p>}
    {form ? 'deal' in form ? <CreatorDealMerchantForm key={form.deal.id} deal={form.deal} initialMerchant={merchant} {...callbacks} /> : <CreatorDealForm key={form.requestId} requestId={form.requestId} creator={form.creator} initialMerchant={merchant} {...callbacks} /> : chosen ? <>
      <EntityPicker type="creator" value={chosen.id ?? ''} selectedLabel={chosen.name} label="연결할 크리에이터" disabled={busy} onPick={(id, name) => { setChosen({ id, name }); setHistoryOffset(0); }} />
      {chosen.id && (!creator ? !error && <p role="status">협업 이력을 불러오는 중입니다.</p> : <>
        <div className="partnership-section-heading"><h3>기존 합의에 벤더 연결</h3><button type="button" onClick={() => { play('selection'); setForm({ creator, requestId: merchantEventId() }); }}>새 협업 기록</button></div>
        {!picked?.deals?.length ? <p className="partnership-muted">아직 합의 이력이 없습니다. 새 협업 조건을 기록해서 연결하세요.</p> : <ol className="creator-deals">{picked.deals.map(deal => <li key={deal.id}><strong>{deal.agreed_on} 합의 · {deal.deliverables}</strong><p>{deal.merchant_name || '벤더 미연결'} · 협업일 {deal.collaboration_on || '미확인'}</p><p>{creatorDealAmount(deal.ad_fee_cents, deal.currency)} 광고비 · {creatorDealAmount(deal.meal_support_cents, deal.currency)} 식사 지원 한도</p><button type="button" disabled={Boolean(deal.merchant_id && deal.merchant_id !== merchant.id)} onClick={() => { play('selection'); setForm({ deal }); }}>{deal.merchant_id && deal.merchant_id !== merchant.id ? '다른 벤더와의 협업' : '이 이력에 연결'}</button></li>)}</ol>}
        <nav className="partnership-pages" aria-label="연결할 협업 이력 페이지"><button type="button" disabled={!historyOffset} onClick={() => { play('selection'); setHistoryOffset(value => Math.max(0, value - 50)); }}>이전 이력</button><button type="button" disabled={!picked?.children_more} onClick={() => { play('selection'); setHistoryOffset(value => value + 50); }}>다음 이력</button></nav>
      </>)}<button type="button" onClick={cancel}>돌아가기</button>
    </> : !current ? !error && <p role="status">연결된 협업을 불러오는 중입니다.</p> : <>
      {!current.rows.length ? <div className="partnership-state"><h3>연결된 크리에이터가 없습니다</h3><p>기존 합의 이력에 이 벤더를 연결하거나 새 협업을 기록해 주세요.</p></div> : <ol className="creator-deals">{current.rows.map(deal => <li key={deal.id}><div className="partnership-section-heading"><div><h3>{deal.creator_name}</h3><p>{deal.collaboration_on || '협업일 미확인'} · 합의 {deal.agreed_on}</p></div><button type="button" onClick={() => { play('selection'); setForm({ deal }); setNotice(''); }}>벤더·협업일 수정</button></div><dl className="creator-deal-costs"><div><dt>광고비</dt><dd>{creatorDealAmount(deal.ad_fee_cents, deal.currency)}</dd></div><div><dt>식사 지원 한도</dt><dd>{creatorDealAmount(deal.meal_support_cents, deal.currency)}</dd></div><div><dt>콘텐츠</dt><dd>{deal.deliverables}</dd></div></dl><a href={deal.creator_profile_url} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>크리에이터 프로필 ↗</a></li>)}</ol>}
      <nav className="partnership-pages" aria-label="벤더 협업 목록 페이지"><button type="button" disabled={!offset} onClick={() => { play('selection'); setOffset(value => Math.max(0, value - 50)); }}>이전</button><span>{offset / 50 + 1}페이지</span><button type="button" disabled={!current.more} onClick={() => { play('selection'); setOffset(value => value + 50); }}>다음</button></nav>
    </>}
  </section>;
}

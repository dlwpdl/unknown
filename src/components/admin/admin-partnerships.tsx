import { useEffect, useRef, useState } from 'react';

import {
  BENEFIT_STATUSES, CAMPAIGN_STATUSES, CREATOR_STATUSES, PARTICIPATION_STAGES, PAYMENT_STATUSES, PARTNERSHIP_ACTIONS,
  CREATOR_DEAL_SORTS, creatorDealAmount, creatorProfiles, loadCreatorDeal, loadPartnerships, partnershipError, type Benefit, type BenefitCoupon, type Creator, type CreatorDirectoryOptions,
  type Participation, type PartnershipPage, type PartnershipRecord, type PartnershipView,
} from '@/lib/admin-partnerships';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { merchantContactLinks, merchantEventId, safeMerchantSourceUrl } from '@/lib/merchant-source';
import { supabase } from '@/lib/supabase';
import { CouponActionForm, CouponIssueForm, CreatorDealForm, PartnershipEditor, type PartnershipEditorState } from './admin-partnership-editors';
import { AdminSearch, AdminSelect } from './admin-table-controls';
import './admin-partnerships.css';

const titles = { creators: '크리에이터', campaigns: '협업 캠페인', benefits: '혜택·쿠폰' };
const explanations = {
  creators: '최근 협업 조건을 비교하고, 쌓인 이력을 다음 제안에 참고하세요.',
  campaigns: '업체와 크리에이터를 연결하고, 지원부터 콘텐츠 제출까지 확인합니다.',
  benefits: '방문 혜택의 조건을 정하고, 누구에게 발급하고 사용했는지 확인합니다.',
};
const recordName = (row: PartnershipRecord) => 'display_name' in row ? row.display_name : row.title;
const date = (value: string | null | undefined) => !value ? '미확인' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const number = (value: number | null | undefined) => value == null ? '미확인' : value.toLocaleString();
function SourceLink({ url, children }: { url?: string | null; children: React.ReactNode }) {
  const { play } = useInteractionFeedback();
  const safe = typeof url === 'string' ? safeMerchantSourceUrl(url) : null;
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{children} ↗</a> : null;
}

export function AdminPartnershipsView({ kind, refreshSignal, onUser, onStateChange }: {
  kind: PartnershipView; refreshSignal: number; onUser: (id: string) => void;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState(''), [input, setInput] = useState(''), [offset, setOffset] = useState(0);
  const [creatorSort, setCreatorSort] = useState<CreatorDirectoryOptions['sort']>('date_desc');
  const [currency, setCurrency] = useState<CreatorDirectoryOptions['currency']>('CAD');
  const [selection, setSelection] = useState<{ kind: PartnershipView; id: string } | null>(null);
  const [childOffset, setChildOffset] = useState(0), [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; page: PartnershipPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<PartnershipEditorState | null>(null);
  const [dealTask, setDealTask] = useState<{ requestId: string; creator: Creator } | null>(null);
  const [couponTask, setCouponTask] = useState<{ requestId: string; benefit: Benefit } | { coupon: BenefitCoupon; action: 'redeem' | 'revoke' } | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const dialog = useRef<HTMLDialogElement>(null), lastTrigger = useRef<HTMLButtonElement | null>(null);
  const id = selection?.kind === kind ? selection.id : null;
  const filterKey = kind === 'creators' ? `${creatorSort}:${currency}` : '';
  const key = `${kind}:${filterKey}:${query}:${offset}:${id}:${childOffset}:${revision}:${refreshSignal}`;
  const error = failure?.key === key ? failure.message : '';
  const responseKey = response?.key;
  const page = response?.key === key ? response.page : null;
  const listKey = `${kind}:${filterKey}:${query}:${offset}:${refreshSignal}:${revision}`;
  const checkedIds = checked.key === listKey ? checked.ids : [];
  const checkedRows = page?.rows.filter(row => checkedIds.includes(row.id)) ?? [];
  const allChecked = Boolean(page?.rows.length) && checkedRows.length === page?.rows.length;
  const record = page?.record;
  const opened = Boolean(id || editor || couponTask || dealTask);

  useEffect(() => {
    if (responseKey === key) return;
    let active = true;
    void loadPartnerships(supabase, kind, query, offset, id, childOffset, kind === 'creators' ? { sort: creatorSort, currency } : undefined)
      .then((data) => { if (active) setResponse({ key, page: data }); })
      .catch((reason) => { if (active) setFailure({ key, message: partnershipError(reason) }); });
    return () => { active = false; };
  }, [key, kind, query, offset, id, childOffset, responseKey, creatorSort, currency]);
  useEffect(() => {
    if (opened && !dialog.current?.open) dialog.current?.showModal();
    if (!opened && dialog.current?.open) { dialog.current.close(); lastTrigger.current?.focus(); }
  }, [opened]);
  useEffect(() => { onStateChange?.({ dirty, busy }); }, [dirty, busy, onStateChange]);
  useEffect(() => () => onStateChange?.({ dirty: false, busy: false }), [onStateChange]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty, busy]);

  function discard() {
    return !busy && (!dirty || window.confirm('입력 화면을 닫을까요? 저장하지 않은 입력은 사라집니다.'));
  }
  function close() {
    if (!discard()) return;
    play('selection'); setEditor(null); setDealTask(null); setCouponTask(null); setSelection(null); setDirty(false); setChildOffset(0);
  }
  function open(row: PartnershipRecord, trigger?: HTMLButtonElement) {
    if (!discard()) return;
    play('selection'); lastTrigger.current = trigger ?? null;
    setSelection({ kind, id: row.id }); setChildOffset(0); setEditor(null); setDealTask(null); setCouponTask(null); setDirty(false); setNotice('');
  }
  function edit(state: PartnershipEditorState) {
    if (!discard()) return;
    play('selection'); setEditor(state); setDealTask(null); setCouponTask(null); setDirty(false); setNotice('');
  }
  async function saved(savedId: string) {
    const targetId = editor && editor.kind !== 'participation' ? savedId : id;
    try {
      const savedDeal = dealTask ? await loadCreatorDeal(supabase, savedId) : null;
      const data = await loadPartnerships(supabase, kind, query, offset, targetId, 0, kind === 'creators' ? { sort: creatorSort, currency } : undefined);
      const matched = dealTask ? savedDeal?.creator_id === dealTask.creator.id && savedDeal.id === savedId && data.record?.id === targetId
        : couponTask ? data.coupons.some((row) => row.id === savedId)
        : editor?.kind === 'participation' ? data.participations.some((row) => row.id === savedId) : data.record?.id === savedId;
      if (!matched) throw new Error('PARTNERSHIP_READBACK_REQUIRED');
      setResponse({ key: `${kind}:${filterKey}:${query}:${offset}:${targetId}:0:${revision}:${refreshSignal}`, page: data });
      if (editor && editor.kind !== 'participation') setSelection({ kind, id: savedId });
      setChildOffset(0); setDirty(false); setEditor(null); setDealTask(null); setCouponTask(null); setNotice('저장한 내용을 확인했습니다.');
    } catch {
      setNotice('서버 저장은 완료됐습니다. 저장 내용 확인이 필요합니다.');
      throw new Error('PARTNERSHIP_READBACK_REQUIRED');
    }
  }
  function cancelEditor() {
    if (!discard()) return;
    play('selection'); setEditor(null); setDealTask(null); setCouponTask(null); setDirty(false);
  }
  function newRecord(event?: React.MouseEvent<HTMLButtonElement>) {
    lastTrigger.current = event?.currentTarget ?? null;
    const singular = kind === 'creators' ? 'creator' : kind === 'campaigns' ? 'campaign' : 'benefit';
    edit({ kind: singular, record: { id: merchantEventId() }, revision: null });
  }
  function participation(row?: Participation) {
    const base = record && 'merchant_id' in record && 'team_limit' in record
      ? { campaign_id: record.id, campaign_title: record.title }
      : record && 'display_name' in record ? { creator_id: record.id, creator_name: record.display_name } : {};
    edit({ kind: 'participation', record: row ? { ...row } : { id: merchantEventId(), ...base }, revision: row?.updated_at ?? null });
  }
  const heading = dealTask ? '협업 합의 조건 기록' : editor ? editor.revision ? '정보 수정' : `${editor.kind === 'participation' ? '참여 팀' : titles[kind]} 등록`
    : couponTask ? 'benefit' in couponTask ? '쿠폰 발급' : couponTask.action === 'redeem' ? '쿠폰 사용 확인' : '쿠폰 취소'
    : record ? recordName(record) : titles[kind];

  return <section className="partnership-admin" aria-label={`${titles[kind]} 관리`}>
    <header className="partnership-heading"><div><h1>{titles[kind]}</h1><p className="partnership-muted">{explanations[kind]}</p></div>
      <button type="button" className="partnership-primary" onClick={newRecord}>{kind === 'creators' ? '크리에이터' : kind === 'campaigns' ? '캠페인' : '혜택'} 등록</button></header>
    {notice && !opened && <p role="status" className="partnership-notice">{notice}</p>}
    <div className="partnership-toolbar"><AdminSearch value={input} onChange={setInput} placeholder={kind === 'creators' ? '이름·지역·SNS 검색' : '이름·업체 검색'} onSubmit={() => { setQuery(input.trim()); setOffset(0); setChecked({ key: listKey, ids: [] }); }} />
      {kind === 'creators' && <><AdminSelect label="정렬" value={creatorSort} options={Object.entries(CREATOR_DEAL_SORTS).map(([value, label]) => ({ value, label }))} onChange={value => { setCreatorSort(value as CreatorDirectoryOptions['sort']); setOffset(0); }} /><AdminSelect label="통화" value={currency} options={['CAD', 'USD'].map(value => ({ value, label: value }))} onChange={value => { setCurrency(value as CreatorDirectoryOptions['currency']); setOffset(0); }} /></>}
      <span className="partnership-muted">{page ? `${page.rows.length}건 표시` : '불러오는 중'}</span></div>
    {kind === 'creators' && <div className="creator-batch-actions" aria-label="선택한 크리에이터 관리">
      <label className="creator-select"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allChecked} disabled={busy || !page?.rows.length} ref={input => { if (input) input.indeterminate = checkedRows.length > 0 && !allChecked; }} onChange={event => { play('selection'); setChecked({ key: listKey, ids: event.target.checked ? page!.rows.map(row => row.id) : [] }); }} />현재 페이지 전체 선택</label>
      <span role="status" aria-live="polite">{checkedRows.length}개 선택</span>
      <button type="button" disabled={busy || !checkedRows.length} onClick={() => { play('selection'); setChecked({ key: listKey, ids: [] }); }}>선택 해제</button>
    </div>}
    {error ? <div role="alert" className="partnership-state"><p>{error}</p><button type="button" onClick={() => { play('selection'); setRevision((value) => value + 1); }}>다시 불러오기</button></div>
      : !page ? <p role="status" className="partnership-state">자료를 불러오는 중입니다.</p>
      : !page.rows.length ? <div className="partnership-state"><h2>{query ? '검색 결과가 없습니다.' : `등록된 ${titles[kind]}가 없습니다.`}</h2><p className="partnership-muted">{query ? '이름이나 업체명을 바꿔서 검색해 주세요.' : '첫 자료를 등록하면 이곳에서 진행 상황을 확인할 수 있습니다.'}</p></div>
      : <div className="partnership-table-wrap" tabIndex={kind === 'creators' ? 0 : undefined} aria-label={kind === 'creators' ? '크리에이터 목록 표 · 가로로 스크롤할 수 있습니다' : undefined}><table className={`partnership-table ${kind === 'creators' ? 'creator-directory' : ''}`}>
        {kind === 'creators' && <caption className="creator-cost-caption">{currency} 최근 합의 조건 · 식사 지원은 한도 기준</caption>}
        <thead><tr>{(kind === 'creators' ? ['선택', '크리에이터', '최근 광고비', '식사 지원 한도', '콘텐츠·합의 날짜', '대표 플랫폼', '팔로워·구독자', '주요 콘텐츠', '활동 지역', '상태', '합의 이력'] : [kind === 'campaigns' ? '캠페인' : '혜택', '업체', '상태', kind === 'campaigns' ? '선정 팀' : '발급·사용']).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
        {page.rows.map((row) => {
          const primary = 'display_name' in row ? creatorProfiles(row)[0] : null;
          return <tr key={row.id} data-selected={id === row.id} data-checked={checkedIds.includes(row.id)}>
            {'display_name' in row && <td><label className="creator-select"><input type="checkbox" aria-label={`${row.display_name} 선택`} disabled={busy} checked={checkedIds.includes(row.id)} onChange={event => { play('selection'); setChecked({ key: listKey, ids: event.target.checked ? [...checkedIds, row.id] : checkedIds.filter(value => value !== row.id) }); }} /></label></td>}
            <td><button type="button" className="partnership-row-button" data-record-id={row.id} title={recordName(row)} onClick={(event) => open(row, event.currentTarget)}><strong>{recordName(row)}</strong>{!('display_name' in row) && <span className="partnership-muted">상세와 진행 내역 보기</span>}</button></td>
            {'display_name' in row && <><td className="creator-cost">{row.latest_deal ? creatorDealAmount(row.latest_deal.ad_fee_cents, row.latest_deal.currency) : '미기록'}</td><td className="creator-cost">{row.latest_deal ? creatorDealAmount(row.latest_deal.meal_support_cents, row.latest_deal.currency) : '미기록'}</td><td title={row.latest_deal?.deliverables}>{row.latest_deal ? <><strong>{row.latest_deal.deliverables}</strong><small>{row.latest_deal.agreed_on}</small></> : '미기록'}</td></>}
          {'display_name' in row ? <><td>{primary ? <SourceLink url={primary.url}>{primary.platform}</SourceLink> : '미확인'}</td><td><strong>{primary?.followers || '미확인'}</strong><small>{primary?.checked_on ? `${primary.checked_on} 확인` : '수치 확인 전'}</small></td><td title={row.category}>{row.category || '미확인'}</td><td title={row.activity_regions}>{row.city_name}<small>{row.activity_regions}</small></td></> : <td>{row.merchant_name}</td>}
          <td><span className="partnership-status">{'display_name' in row ? CREATOR_STATUSES[row.status] : 'team_limit' in row ? CAMPAIGN_STATUSES[row.status] : BENEFIT_STATUSES[row.status]}</span></td>
          <td>{'display_name' in row ? `${number(row.deal_count)}건` : 'team_limit' in row ? `${number(row.selected_count)}${row.team_limit ? ` / ${number(row.team_limit)}` : ''}팀` : `${number(row.issued_count)} 발급 · ${number(row.redeemed_count)} 사용`}</td></tr>;
        })}
      </tbody></table></div>}
    <nav className="partnership-pages" aria-label="목록 페이지"><button type="button" disabled={offset === 0 || !page} onClick={() => { play('selection'); setChecked({ key: listKey, ids: [] }); setOffset((value) => Math.max(0, value - 50)); }}>이전</button><span>{Math.floor(offset / 50) + 1}페이지</span><button type="button" disabled={!page?.more} onClick={() => { play('selection'); setChecked({ key: listKey, ids: [] }); setOffset((value) => value + 50); }}>다음</button></nav>

    <dialog ref={dialog} className="partnership-dialog" aria-labelledby="partnership-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="partnership-dialog-heading"><h2 id="partnership-dialog-title">{heading}</h2><button type="button" aria-label="상세 닫기" disabled={busy} onClick={close}>닫기</button></header>
      <div className="partnership-dialog-body">
        {notice && !editor && !couponTask && !dealTask && <p role="status" className="partnership-notice">{notice}</p>}
        {dealTask ? <CreatorDealForm key={dealTask.requestId} requestId={dealTask.requestId} creator={dealTask.creator} initialCurrency={currency} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : editor ? <PartnershipEditor key={`${editor.kind}:${editor.record.id}:${editor.revision}`} state={editor} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : couponTask ? 'benefit' in couponTask ? <CouponIssueForm key={couponTask.requestId} requestId={couponTask.requestId} benefit={couponTask.benefit} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
            : <CouponActionForm key={`${couponTask.coupon.id}:${couponTask.action}`} coupon={couponTask.coupon} action={couponTask.action} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { play('selection'); setRevision((value) => value + 1); }}>다시 불러오기</button></div>
          : !record ? <p role="status">상세 내용을 불러오는 중입니다.</p>
          : <>
            <div className="partnership-detail-actions"><button type="button" onClick={() => edit({ kind: kind === 'creators' ? 'creator' : kind === 'campaigns' ? 'campaign' : 'benefit', record: { ...record }, revision: record.updated_at })}>정보 수정</button>
              {'issued_count' in record && <button type="button" className="partnership-primary" disabled={record.status !== 'active'} onClick={() => { play('selection'); setCouponTask({ requestId: merchantEventId(), benefit: record }); }}>쿠폰 발급</button>}</div>
            {'display_name' in record ? <>
              <section className="creator-deal-history"><div className="partnership-section-heading"><h3>협업 합의 이력</h3><button type="button" className="partnership-primary" onClick={() => { play('selection'); setDealTask({ requestId: merchantEventId(), creator: record }); setEditor(null); setCouponTask(null); setDirty(false); setNotice(''); }}>합의 조건 기록</button></div>
                {!page?.deals?.length ? <p className="partnership-muted">기록한 합의 조건이 없습니다. 이전 메모는 아래에서 확인할 수 있습니다.</p> : <ol className="creator-deals">{page.deals.map(deal => <li key={deal.id}><div className="partnership-section-heading"><strong>{deal.agreed_on} · {deal.merchant_name || '업체 미연결'}</strong><span className="partnership-status">합의 조건</span></div><dl className="creator-deal-costs"><div><dt>광고비</dt><dd>{creatorDealAmount(deal.ad_fee_cents, deal.currency)}</dd></div><div><dt>식사 지원 한도</dt><dd>{creatorDealAmount(deal.meal_support_cents, deal.currency)}</dd></div><div><dt>콘텐츠</dt><dd>{deal.deliverables}</dd></div></dl><p className="partnership-copy">{deal.notes}</p>{deal.source_url && <SourceLink url={deal.source_url}>합의 근거</SourceLink>}<small className="partnership-muted creator-fact-note">{deal.recorded_by_name || '관리자'} 기록 · {date(deal.created_at)}</small></li>)}</ol>}
              </section>
              <dl className="partnership-facts"><div><dt>활동 지역</dt><dd>{record.city_name}{record.activity_regions && <small className="partnership-muted creator-fact-note">{record.activity_regions}</small>}</dd></div><div><dt>주요 콘텐츠</dt><dd>{record.category || '미확인'}</dd></div><div><dt>담당자 이름</dt><dd>{record.contact_name || '미확인'}</dd></div><div><dt>연락처·연락 경로</dt><dd className="partnership-copy">{record.contact ? merchantContactLinks(record.contact).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{part.text}</a> : part.text) : '미확인'}</dd></div><div><dt>상태</dt><dd>{CREATOR_STATUSES[record.status]}</dd></div><div><dt>글링 회원</dt><dd>{record.member_id ? <button type="button" onClick={() => { play('selection'); onUser(record.member_id!); }}>{record.member_name || '연결된 회원'} 보기</button> : '아직 연결하지 않음'}</dd></div></dl>
              <section className="partnership-detail-section"><h3>소개·콘텐츠 특징</h3><p className="partnership-copy">{record.content_summary || '추가로 확인한 소개가 없습니다.'}</p></section>
              <section className="partnership-detail-section"><h3>운영 플랫폼</h3><div className="creator-platforms">{creatorProfiles(record).map((profile, index) => <div className="creator-platform" key={profile.url}><div><strong>{profile.platform}</strong>{index === 0 && <span className="partnership-status">대표</span>}<div><SourceLink url={profile.url}>{profile.url}</SourceLink></div></div><div className="creator-audience"><span className="partnership-muted">팔로워·구독자</span><strong>{profile.followers || '미확인'}</strong><small className="partnership-muted">{profile.checked_on ? `${profile.checked_on} 확인` : '수치 확인 전'}</small></div></div>)}</div><p className="partnership-muted">공개 프로필에서 확인한 표시 수치입니다. 플랫폼별 이용자가 겹칠 수 있습니다.</p></section>
              <section className="partnership-detail-section"><h3>협업·다음 제안 메모</h3><p className="partnership-copy">{record.notes || '아직 기록한 메모가 없습니다.'}</p></section>
              <section className="partnership-detail-section"><h3>참고 콘텐츠·확인 근거</h3><p>조회수 {number(record.reference_views)} · 운영자 확인 기록</p><SourceLink url={record.reference_url}>참고 원문</SourceLink><p className="partnership-copy">{record.metrics_note || '추가 확인 메모가 없습니다.'}</p></section></>
              : 'team_limit' in record ? <><dl className="partnership-facts"><div><dt>업체</dt><dd>{record.merchant_name}</dd></div><div><dt>진행</dt><dd>{CAMPAIGN_STATUSES[record.status]}</dd></div><div><dt>선정</dt><dd>{number(record.selected_count)} / {record.team_limit ?? '정원 미정'}팀 · 지원 {number(record.applicant_count)}팀</dd></div><div><dt>종료일</dt><dd>{record.ends_on ? `${record.ends_on}${record.deadline_note ? ` · ${record.deadline_note}` : ''}` : record.deadline_note || '종료일 확인 중'}</dd></div><div><dt>지원 제안액</dt><dd>{record.support_amount_cents == null ? '미정' : `${(record.support_amount_cents / 100).toFixed(2)} ${record.currency ?? '(통화 미확정)'}`}</dd></div><div><dt>참고 조회수 기준</dt><dd>{record.minimum_views == null ? '별도 기준 없음' : `${number(record.minimum_views)}회`}</dd></div></dl><Terms text={record.terms} confirmed={record.terms_confirmed} /><p className="partnership-copy partnership-muted">{record.notes}</p></>
                : <><dl className="partnership-facts"><div><dt>업체</dt><dd>{record.merchant_name}</dd></div><div><dt>대상</dt><dd>{record.audience === 'creators' ? '크리에이터' : '일반 회원'}</dd></div><div><dt>혜택</dt><dd>{record.discount_percent == null ? '상세 조건 참고' : `${record.discount_percent}% 할인`}</dd></div><div><dt>유효기한</dt><dd>{record.expires_on ?? '확인 중'}</dd></div><div><dt>발급·사용</dt><dd>{number(record.issued_count)} 발급 · {number(record.redeemed_count)} 사용</dd></div><div><dt>연결 캠페인</dt><dd>{record.campaign_title || '독립 방문 혜택'}</dd></div></dl><Terms text={record.terms} confirmed={record.terms_confirmed} />{record.status !== 'active' && <p className="partnership-muted">활성 상태와 확정된 조건·기한이 있어야 쿠폰을 발급할 수 있습니다.</p>}</>}
            {kind !== 'benefits' ? <section className="partnership-detail-section"><div className="partnership-section-heading"><h3>{kind === 'creators' ? '참여한 협업' : '지원·선정 팀'}</h3><button type="button" onClick={() => participation()}>참여 팀 등록</button></div>
              {!page?.participations.length ? <p className="partnership-muted">아직 등록한 참여 팀이 없습니다.</p> : <div className="partnership-table-wrap"><table className="partnership-table"><thead><tr><th>{kind === 'creators' ? '캠페인' : '크리에이터'}</th><th>진행</th><th>방문·콘텐츠</th><th>지원금 기록</th></tr></thead><tbody>{page.participations.map((row) => <tr key={row.id}><td><button type="button" className="partnership-row-button" onClick={() => participation(row)}><strong>{kind === 'creators' ? row.campaign_title : row.creator_name}</strong><span className="partnership-muted">진행 기록 수정</span></button></td><td>{PARTICIPATION_STAGES[row.stage]}</td><td>{row.content_url ? <SourceLink url={row.content_url}>제출 콘텐츠</SourceLink> : row.visited_at ? date(row.visited_at) : row.scheduled_at ? `예정 ${date(row.scheduled_at)}` : '일정 미정'}{row.actual_views != null && <small>조회 {number(row.actual_views)}</small>}</td><td>{PAYMENT_STATUSES[row.payment_status]}</td></tr>)}</tbody></table></div>}
            </section> : <section className="partnership-detail-section"><h3>쿠폰 발급·사용 내역</h3>{!page?.coupons.length ? <p className="partnership-muted">발급한 쿠폰이 없습니다.</p> : <div className="partnership-table-wrap"><table className="partnership-table"><thead><tr><th>수령 대상</th><th>쿠폰</th><th>상태·기한</th><th>처리</th></tr></thead><tbody>{page.coupons.map((coupon) => <tr key={coupon.id}><td>{coupon.recipient_name}</td><td><span className="partnership-code">{coupon.code}</span></td><td>{coupon.status === 'redeemed' ? '사용 완료' : coupon.status === 'revoked' ? '취소' : coupon.expired ? '기한 만료' : '사용 전'}<small>{coupon.expires_on}</small></td><td><div className="partnership-inline-actions">{coupon.status === 'issued' && <><button type="button" disabled={coupon.expired} onClick={() => { play('selection'); setCouponTask({ coupon, action: 'redeem' }); }}>사용 확인</button><button type="button" onClick={() => { play('selection'); setCouponTask({ coupon, action: 'revoke' }); }}>취소</button></>}</div></td></tr>)}</tbody></table></div>}</section>}
            <nav className="partnership-pages" aria-label="상세 기록 페이지"><button type="button" disabled={childOffset === 0} onClick={() => { play('selection'); setChildOffset((value) => Math.max(0, value - 50)); }}>이전 기록</button><span>{Math.floor(childOffset / 50) + 1}페이지</span><button type="button" disabled={!page?.children_more} onClick={() => { play('selection'); setChildOffset((value) => value + 50); }}>다음 기록</button></nav>
            <section className="partnership-detail-section"><h3>최근 운영 이력</h3>{!page?.events.length ? <p className="partnership-muted">추가 이력이 없습니다.</p> : <ul className="partnership-history">{page.events.map((event) => <li key={event.id}><strong>{PARTNERSHIP_ACTIONS[event.action] ?? '운영 기록 변경'}</strong><span>{event.actor_name || '관리자'} · {date(event.created_at)}</span></li>)}</ul>}</section>
          </>}
      </div>
    </dialog>
  </section>;
}

function Terms({ text, confirmed }: { text: string; confirmed: boolean }) {
  return <section className="partnership-detail-section"><h3>제공 조건 <span className="partnership-status">{confirmed ? '확정 기록' : '확인 중'}</span></h3><p className="partnership-copy">{text || '조건을 정리하고 있습니다.'}</p></section>;
}

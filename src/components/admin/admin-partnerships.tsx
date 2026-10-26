import { useEffect, useRef, useState } from 'react';

import {
  BENEFIT_STATUSES, CAMPAIGN_STATUSES, CREATOR_STATUSES, PARTICIPATION_STAGES, PAYMENT_STATUSES, PARTNERSHIP_ACTIONS,
  CREATOR_DEAL_SORTS, creatorDealAmount, creatorProfiles, loadCreatorDeal, loadPartnerships, partnershipError, type Benefit, type BenefitCoupon, type Creator, type CreatorDeal, type CreatorDirectoryOptions,
  type Participation, type PartnershipPage, type PartnershipRecord, type PartnershipView,
} from '@/lib/admin-partnerships';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { merchantContactLinks, merchantEventId, safeMerchantSourceUrl } from '@/lib/merchant-source';
import { supabase } from '@/lib/supabase';
import { CouponActionForm, CouponIssueForm, CreatorDealForm, CreatorDealMerchantForm, PartnershipEditor, type PartnershipEditorState } from './admin-partnership-editors';
import { AdminSearch, AdminSelect } from './admin-table-controls';
import { AdminButton, AdminCard, AdminDock, AdminFacts, AdminInfo, AdminMoreMenu, AdminPill } from './admin-ui';
import './admin-partnerships.css';
import './admin-partner-workspace.css';
import './admin-partnership-detail.css';

const titles = { creators: '크리에이터', campaigns: '협업 캠페인', benefits: '혜택·쿠폰' };
const explanations = {
  creators: '최근 협업 조건을 비교하고, 쌓인 이력을 다음 제안에 참고해요.',
  campaigns: '비즈니스와 크리에이터를 연결하고, 지원부터 콘텐츠 제출까지 확인해요.',
  benefits: '방문 혜택의 조건을 정하고, 누구에게 발급하고 사용했는지 확인해요.',
};
const today = () => new Date().toLocaleDateString('sv-SE');
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
  const [detailTab, setDetailTab] = useState<'deals' | 'profile' | 'campaigns'>('deals');
  const [currency, setCurrency] = useState<CreatorDirectoryOptions['currency']>('CAD');
  const [selection, setSelection] = useState<{ kind: PartnershipView; id: string } | null>(null);
  const [childOffset, setChildOffset] = useState(0), [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; page: PartnershipPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<PartnershipEditorState | null>(null);
  const [dealTask, setDealTask] = useState<{ requestId: string; creator: Creator; deal?: CreatorDeal } | null>(null);
  const [couponTask, setCouponTask] = useState<{ requestId: string; benefit: Benefit } | { coupon: BenefitCoupon; action: 'redeem' | 'revoke' } | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), lastTrigger = useRef<HTMLButtonElement | null>(null);
  const detailBody = useRef<HTMLDivElement>(null);
  const id = selection?.kind === kind ? selection.id : null;
  const filterKey = kind === 'creators' ? `${creatorSort}:${currency}` : '';
  const key = `${kind}:${filterKey}:${query}:${offset}:${id}:${childOffset}:${revision}:${refreshSignal}`;
  const error = failure?.key === key ? failure.message : '';
  const responseKey = response?.key;
  const page = response?.key === key ? response.page : null;
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
  useEffect(() => { if (detailBody.current) detailBody.current.scrollTop = 0; }, [opened, id, detailTab, editor, dealTask, couponTask]);
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
    setSelection({ kind, id: row.id }); setDetailTab('deals'); setChildOffset(0); setEditor(null); setDealTask(null); setCouponTask(null); setDirty(false); setNotice('');
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
  const heading = dealTask ? dealTask.deal ? '비즈니스·협업일 연결' : '협업 합의 조건 기록' : editor ? editor.revision ? '정보 수정' : `${editor.kind === 'participation' ? '참여 팀' : titles[kind]} 등록`
    : couponTask ? 'benefit' in couponTask ? '쿠폰 발급' : couponTask.action === 'redeem' ? '쿠폰 사용 확인' : '쿠폰 취소'
    : record ? recordName(record) : titles[kind];
  const contextRecord = !editor && !dealTask && !couponTask ? record : null;
  // The directory row carries the latest agreement and count for the selected currency; the detail record may not.
  const contextCreator = contextRecord && 'display_name' in contextRecord ? contextRecord : null;
  const listedCreator = contextCreator ? (page?.rows.find(row => row.id === contextCreator.id) as Creator | undefined) : undefined;
  const latestDeal = listedCreator?.latest_deal ?? contextCreator?.latest_deal ?? null;
  const dealCount = listedCreator?.deal_count ?? contextCreator?.deal_count;
  const contextProfile = contextCreator ? creatorProfiles(contextCreator)[0] : null;

  return <section className="partnership-admin partner-workspace partnership-workspace" data-kind={kind} aria-label={`${titles[kind]} 관리`}>
    <header className="partnership-heading"><div className="partnership-title-row"><h1>{titles[kind]}</h1><AdminInfo label={`${titles[kind]} 화면 설명`} text={explanations[kind]} /></div>
      <button type="button" className="partnership-primary" onClick={newRecord}>{kind === 'creators' ? '크리에이터' : kind === 'campaigns' ? '캠페인' : '혜택'} 등록</button></header>
    {notice && !opened && <p role="status" className="partnership-notice">{notice}</p>}
    <div className="partnership-toolbar"><AdminSearch value={input} onChange={setInput} placeholder={kind === 'creators' ? '이름·지역·SNS 검색' : '이름·비즈니스 검색'} onSubmit={() => { setQuery(input.trim()); setOffset(0); }} />
      {kind === 'creators' && <><AdminSelect label="정렬" value={creatorSort} options={Object.entries(CREATOR_DEAL_SORTS).map(([value, label]) => ({ value, label }))} onChange={value => { setCreatorSort(value as CreatorDirectoryOptions['sort']); setOffset(0); }} /><AdminSelect label="통화" value={currency} options={['CAD', 'USD'].map(value => ({ value, label: value }))} onChange={value => { setCurrency(value as CreatorDirectoryOptions['currency']); setOffset(0); }} /></>}
      <span className="partnership-muted">{page ? `${page.rows.length}건 표시` : '불러오는 중'}</span></div>
    {error ? <div role="alert" className="partnership-state"><p>{error}</p><button type="button" onClick={() => { play('selection'); setRevision((value) => value + 1); }}>다시 불러오기</button></div>
      : !page ? <p role="status" className="partnership-state">자료를 불러오는 중입니다.</p>
      : !page.rows.length ? <div className="partnership-state"><h2>{query ? '검색 결과가 없습니다.' : `등록된 ${titles[kind]}가 없습니다.`}</h2><p className="partnership-muted">{query ? '이름이나 비즈니스명을 바꿔서 검색해 주세요.' : '첫 자료를 등록하면 이곳에서 진행 상황을 확인할 수 있습니다.'}</p></div>
      : <div className="partnership-table-wrap partnership-directory" tabIndex={0} aria-label={`${titles[kind]} 목록 표 · 가로로 스크롤할 수 있습니다`}><table className={`partnership-table partnership-directory-table ${kind === 'creators' ? 'creator-directory' : ''}`}>
        {kind === 'creators' && <caption className="creator-cost-caption">{currency} 최근 합의 조건 · 협업일은 예정 포함 · 식사 지원은 한도 기준</caption>}
        <thead><tr>{(kind === 'creators' ? ['크리에이터·SNS','최근 협업', '광고비', '식사 지원 한도', '상태', '합의 이력'] : [kind === 'campaigns' ? '캠페인' : '혜택', '비즈니스', '상태', kind === 'campaigns' ? '선정 팀' : '발급·사용']).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
        {page.rows.map((row) => {
          const primary = 'display_name' in row ? creatorProfiles(row)[0] : null;
          return <tr key={row.id} data-selected={id === row.id}>
            <td data-label={kind === 'creators' ? '크리에이터' : kind === 'campaigns' ? '캠페인' : '혜택'} className="creator-identity-cell"><div className="creator-identity"><button type="button" className="partnership-row-button" data-record-id={row.id} title={recordName(row)} onClick={(event) => open(row, event.currentTarget)}><strong>{recordName(row)}</strong>{'display_name' in row ? <small>{primary?.followers || '팔로워 미확인'} · {row.city_name}</small> : null}</button>{'display_name' in row && primary && <SourceLink url={primary.url}>{primary.platform}</SourceLink>}</div></td>
            {'display_name' in row ? <><td data-label="최근 협업" className="creator-latest" title={row.latest_deal ? `${row.latest_deal.deliverables} · 합의 ${row.latest_deal.agreed_on}` : undefined}>{row.latest_deal ? <><strong>{row.latest_deal.merchant_name || '비즈니스 미연결'}</strong><small>협업 {row.latest_deal.collaboration_on || '날짜 미확인'}</small><small>{row.latest_deal.deliverables} · 합의 {row.latest_deal.agreed_on}</small></> : <span className="partnership-muted">{row.deal_count ? `${currency} 기록 없음` : '아직 기록 없음'}</span>}</td><td data-label="광고비" className="creator-cost">{row.latest_deal ? creatorDealAmount(row.latest_deal.ad_fee_cents, row.latest_deal.currency) : '미기록'}</td><td data-label="식사 지원 한도" className="creator-cost">{row.latest_deal ? creatorDealAmount(row.latest_deal.meal_support_cents, row.latest_deal.currency) : '미기록'}</td></> : <td data-label="비즈니스">{row.merchant_name}</td>}
          <td data-label="상태"><span className="partnership-status" data-status={row.status}>{'display_name' in row ? CREATOR_STATUSES[row.status] : 'team_limit' in row ? CAMPAIGN_STATUSES[row.status] : BENEFIT_STATUSES[row.status]}</span></td>
          <td data-label={kind === 'creators' ? '합의 이력' : kind === 'campaigns' ? '선정 팀' : '발급·사용'}>{'display_name' in row ? <button type="button" className="creator-history-button" onClick={event => open(row, event.currentTarget)}>{number(row.deal_count)}건 보기</button> : 'team_limit' in row ? `${number(row.selected_count)}${row.team_limit ? ` / ${number(row.team_limit)}` : ''}팀` : `${number(row.issued_count)} 발급 · ${number(row.redeemed_count)} 사용`}</td></tr>;
        })}
      </tbody></table></div>}
    <nav className="partnership-pages" aria-label="목록 페이지"><button type="button" disabled={offset === 0 || !page} onClick={() => { play('selection'); setOffset((value) => Math.max(0, value - 50)); }}>이전</button><span>{Math.floor(offset / 50) + 1}페이지</span><button type="button" disabled={!page?.more} onClick={() => { play('selection'); setOffset((value) => value + 50); }}>다음</button></nav>

    <dialog ref={dialog} className="partnership-dialog" aria-labelledby="partnership-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="partnership-detail-chrome"><header className="partnership-dialog-heading">
        {contextRecord && <span className="partnership-detail-avatar" aria-hidden="true">{[...recordName(contextRecord).trim()][0]}</span>}
        <div className="partnership-detail-title"><h2 id="partnership-dialog-title" title={heading}>{heading}</h2>
          {contextRecord && <div className="partnership-detail-context"><span className="partnership-status" data-status={contextRecord.status}>{'display_name' in contextRecord ? CREATOR_STATUSES[contextRecord.status] : 'team_limit' in contextRecord ? CAMPAIGN_STATUSES[contextRecord.status] : BENEFIT_STATUSES[contextRecord.status]}</span><span>{contextCreator ? [contextProfile && `${contextProfile.platform} ${contextProfile.followers || '팔로워 미확인'}`, contextCreator.city_name, contextCreator.category].filter(Boolean).join(' · ') : 'merchant_name' in contextRecord ? contextRecord.merchant_name : ''}</span></div>}
        </div><button type="button" className="partnership-detail-close" aria-label="상세 닫기" disabled={busy} onClick={close}>×</button>
      </header>
      {contextCreator && <div className="partnership-detail-facts"><AdminFacts items={[
        { label: '최근 협업', value: latestDeal ? `${latestDeal.collaboration_on || '날짜 미확인'}${latestDeal.collaboration_on && latestDeal.collaboration_on > today() ? ' 예정' : ''}` : '기록 없음' },
        { label: '광고비', value: latestDeal ? creatorDealAmount(latestDeal.ad_fee_cents, latestDeal.currency) : '미기록' },
        { label: '식사 한도', value: latestDeal ? creatorDealAmount(latestDeal.meal_support_cents, latestDeal.currency) : '미기록' },
        { label: '합의', value: dealCount == null ? '미확인' : `${number(dealCount)}건` },
      ]} /></div>}
      {contextCreator && <nav className="partner-detail-tabs" aria-label="크리에이터 상세 화면">{([['deals', '협업 이력'], ['profile', '프로필·연락처'], ['campaigns', '캠페인 참여']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={detailTab === value} onClick={() => { play('selection'); setDetailTab(value); setChildOffset(0); }}>{label}</button>)}</nav>}
      </div>
      <div className="partnership-dialog-body" ref={detailBody}>
        {notice && !editor && !couponTask && !dealTask && <p role="status" className="partnership-notice">{notice}</p>}
        {dealTask ? dealTask.deal ? <CreatorDealMerchantForm key={dealTask.deal.id} deal={dealTask.deal} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} /> : <CreatorDealForm key={dealTask.requestId} requestId={dealTask.requestId} creator={dealTask.creator} initialCurrency={currency} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : editor ? <PartnershipEditor key={`${editor.kind}:${editor.record.id}:${editor.revision}`} state={editor} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : couponTask ? 'benefit' in couponTask ? <CouponIssueForm key={couponTask.requestId} requestId={couponTask.requestId} benefit={couponTask.benefit} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
            : <CouponActionForm key={`${couponTask.coupon.id}:${couponTask.action}`} coupon={couponTask.coupon} action={couponTask.action} onSaved={saved} onCancel={cancelEditor} onDirty={setDirty} onBusy={setBusy} />
          : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { play('selection'); setRevision((value) => value + 1); }}>다시 불러오기</button></div>
          : !record ? <p role="status">상세 내용을 불러오는 중입니다.</p>
          : <>
            {'display_name' in record ? <>
              <div hidden={detailTab !== 'deals'}>
              <AdminCard icon="◷" tone="accent" title="합의 이력" info={['협업일에는 예정일도 들어 있어요. 실제 방문·지급·게시는 따로 확인해 주세요.', '식사 지원은 한도 기준이에요.']}
                action={<AdminButton kind="primary" label="＋ 합의 기록" accessibilityLabel="합의 조건 기록" onPress={() => { setDealTask({ requestId: merchantEventId(), creator: record }); setEditor(null); setCouponTask(null); setDirty(false); setNotice(''); }} />}>
                {!page?.deals?.length ? <p className="partnership-muted">아직 기록한 합의가 없어요. 이전 메모는 프로필 탭에 있어요.</p> : <ol className="creator-deals">{page.deals.map(deal => {
                  const linkDeal = () => { setDealTask({ requestId: deal.id, creator: record, deal }); setDirty(false); setNotice(''); };
                  return <li key={deal.id} className="creator-deal"><div className="creator-deal-main">
                    <div className="partnership-title-row"><strong>{deal.merchant_name || '비즈니스 미연결'}</strong>{!!deal.collaboration_on && deal.collaboration_on > today() && <AdminPill label="예정" tone="warning" />}</div>
                    <small className="partnership-muted">{deal.collaboration_on || '협업일 미확인'} · {deal.deliverables} · 합의 {deal.agreed_on}</small>
                    <div className="creator-deal-chips"><AdminPill label={`광고비 ${creatorDealAmount(deal.ad_fee_cents, deal.currency)}`} /><AdminPill label={`식사 ${creatorDealAmount(deal.meal_support_cents, deal.currency)}`} />{!!deal.source_url && <SourceLink url={deal.source_url}>근거</SourceLink>}</div>
                    {!!deal.notes && <p className="partnership-copy">{deal.notes}</p>}
                    <small className="partnership-muted">{deal.recorded_by_name || '관리자'} 기록 · {date(deal.created_at)}</small>
                  </div>{deal.merchant_id ? <AdminMoreMenu label={`${deal.merchant_name || '합의'} 기록 더 보기`} items={[{ label: '비즈니스·협업일 수정', onPress: linkDeal }]} />
                    : <AdminButton label="비즈니스 연결" accessibilityLabel="비즈니스·협업일 연결" onPress={linkDeal} />}</li>;
                })}</ol>}
              </AdminCard>
              </div><div className="creator-detail-profile" hidden={detailTab !== 'profile'}>
              <AdminFacts columns={2} items={[
                { label: '상세 활동 지역', value: record.activity_regions || record.city_name },
                { label: '주요 콘텐츠', value: record.category || '미확인' },
                { label: '담당자 이름', value: record.contact_name || '미확인' },
                { label: '연락처·연락 경로', value: record.contact ? <span className="creator-fact-copy">{merchantContactLinks(record.contact).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{part.text}</a> : part.text)}</span> : '미확인' },
                { label: '글링 회원', value: record.member_id ? <button type="button" className="creator-fact-button" onClick={() => { play('selection'); onUser(record.member_id!); }}>{record.member_name || '연결된 회원'} 보기</button> : '아직 연결하지 않음' },
              ]} />
              <section className="partnership-detail-section"><h3>소개·콘텐츠 특징</h3><p className="partnership-copy">{record.content_summary || '추가로 확인한 소개가 없어요.'}</p></section>
              <section className="partnership-detail-section"><div className="partnership-title-row"><h3>운영 플랫폼</h3><AdminInfo label="팔로워 수치 기준" text="공개 프로필에서 확인한 표시 수치예요. 플랫폼별 이용자가 겹칠 수 있어요." /></div><div className="creator-platforms">{creatorProfiles(record).map((profile, index) => <div className="creator-platform" key={profile.url}><div><strong>{profile.platform}</strong>{index === 0 && <span className="partnership-status">대표</span>}<div><SourceLink url={profile.url}>{profile.url}</SourceLink></div></div><div className="creator-audience"><span className="partnership-muted">팔로워·구독자</span><strong>{profile.followers || '미확인'}</strong><small className="partnership-muted">{profile.checked_on ? `${profile.checked_on} 확인` : '수치 확인 전'}</small></div></div>)}</div></section>
              <section className="partnership-detail-section"><h3>협업·다음 제안 메모</h3><p className="partnership-copy">{record.notes || '아직 기록한 메모가 없어요.'}</p></section>
              <section className="partnership-detail-section"><h3>참고 콘텐츠·확인 근거</h3><p>조회수 {number(record.reference_views)} · 운영자 확인 기록</p><SourceLink url={record.reference_url}>참고 원문</SourceLink><p className="partnership-copy">{record.metrics_note || '추가 확인 메모가 없어요.'}</p></section></div></>
              : 'team_limit' in record ? <><AdminFacts items={[
                { label: '선정', value: `${number(record.selected_count)} / ${record.team_limit ?? '정원 미정'}팀 · 지원 ${number(record.applicant_count)}팀` },
                { label: '종료일', value: record.ends_on ? `${record.ends_on}${record.deadline_note ? ` · ${record.deadline_note}` : ''}` : record.deadline_note || '종료일 확인 중' },
                { label: '지원 제안액', value: record.support_amount_cents == null ? '미정' : `${(record.support_amount_cents / 100).toFixed(2)} ${record.currency ?? '(통화 미확정)'}` },
                { label: '참고 조회수 기준', value: record.minimum_views == null ? '별도 기준 없음' : `${number(record.minimum_views)}회` },
              ]} /><Terms text={record.terms} confirmed={record.terms_confirmed} />{!!record.notes && <p className="partnership-copy partnership-muted">{record.notes}</p>}</>
                : <><AdminFacts columns={3} items={[
                  { label: '대상', value: record.audience === 'creators' ? '크리에이터' : '일반 회원' },
                  { label: '혜택', value: record.discount_percent == null ? '상세 조건 참고' : `${record.discount_percent}% 할인` },
                  { label: '유효기한', value: record.expires_on ?? '확인 중' },
                  { label: '발급·사용', value: `${number(record.issued_count)} 발급 · ${number(record.redeemed_count)} 사용` },
                  { label: '연결 캠페인', value: record.campaign_title || '독립 방문 혜택' },
                ]} /><Terms text={record.terms} confirmed={record.terms_confirmed} /></>}
            {kind !== 'benefits' ? <section className="partnership-detail-section" hidden={kind === 'creators' && detailTab !== 'campaigns'}><div className="partnership-section-heading"><h3>{kind === 'creators' ? '참여한 협업' : '지원·선정 팀'}</h3><button type="button" onClick={() => participation()}>참여 팀 등록</button></div>
              {!page?.participations.length ? <p className="partnership-muted">아직 등록한 참여 팀이 없어요.</p> : <div className="partnership-table-wrap"><table className="partnership-table"><thead><tr><th>{kind === 'creators' ? '캠페인' : '크리에이터'}</th><th>진행</th><th>방문·콘텐츠</th><th>지원금 기록</th></tr></thead><tbody>{page.participations.map((row) => <tr key={row.id}><td><button type="button" className="partnership-row-button" aria-label={`${kind === 'creators' ? row.campaign_title : row.creator_name} 진행 기록 수정`} onClick={() => participation(row)}><strong>{kind === 'creators' ? row.campaign_title : row.creator_name}</strong></button></td><td>{PARTICIPATION_STAGES[row.stage]}</td><td>{row.content_url ? <SourceLink url={row.content_url}>제출 콘텐츠</SourceLink> : row.visited_at ? date(row.visited_at) : row.scheduled_at ? `예정 ${date(row.scheduled_at)}` : '일정 미정'}{row.actual_views != null && <small>조회 {number(row.actual_views)}</small>}</td><td>{PAYMENT_STATUSES[row.payment_status]}</td></tr>)}</tbody></table></div>}
            </section> : <section className="partnership-detail-section"><h3>쿠폰 발급·사용 내역</h3>{!page?.coupons.length ? <p className="partnership-muted">발급한 쿠폰이 없어요.</p> : <div className="partnership-table-wrap"><table className="partnership-table"><thead><tr><th>수령 대상</th><th>쿠폰</th><th>상태·기한</th><th>처리</th></tr></thead><tbody>{page.coupons.map((coupon) => <tr key={coupon.id}><td>{coupon.recipient_name}</td><td><span className="partnership-code">{coupon.code}</span></td><td>{coupon.status === 'redeemed' ? '사용 완료' : coupon.status === 'revoked' ? '취소' : coupon.expired ? '기한 만료' : '사용 전'}<small>{coupon.expires_on}</small></td><td><div className="partnership-inline-actions">{coupon.status === 'issued' && <><button type="button" disabled={coupon.expired} onClick={() => { play('selection'); setCouponTask({ coupon, action: 'redeem' }); }}>사용 확인</button><button type="button" className="partnership-danger" onClick={() => { play('warning'); setCouponTask({ coupon, action: 'revoke' }); }}>취소</button></>}</div></td></tr>)}</tbody></table></div>}</section>}
            <nav className="partnership-pages" hidden={kind === 'creators' && detailTab === 'profile'} aria-label="상세 기록 페이지"><button type="button" disabled={childOffset === 0} onClick={() => { play('selection'); setChildOffset((value) => Math.max(0, value - 50)); }}>이전 기록</button><span>{Math.floor(childOffset / 50) + 1}페이지</span><button type="button" disabled={!page?.children_more} onClick={() => { play('selection'); setChildOffset((value) => value + 50); }}>다음 기록</button></nav>
            <details className="partnership-detail-section creator-audit" onToggle={() => play('selection')}><summary>최근 운영 이력{page?.events.length ? ` ${page.events.length}건` : ''}</summary>{!page?.events.length ? <p className="partnership-muted">추가 이력이 없어요.</p> : <ul className="partnership-history">{page.events.map((event) => <li key={event.id}><strong>{PARTNERSHIP_ACTIONS[event.action] ?? '운영 기록 변경'}</strong><span>{event.actor_name || '관리자'} · {date(event.created_at)}</span></li>)}</ul>}</details>
            <AdminDock><AdminButton label="정보 수정" onPress={() => edit({ kind: kind === 'creators' ? 'creator' : kind === 'campaigns' ? 'campaign' : 'benefit', record: { ...record }, revision: record.updated_at })} />
              {'issued_count' in record && <><AdminButton kind="primary" label="쿠폰 발급" disabled={record.status !== 'active'} onPress={() => setCouponTask({ requestId: merchantEventId(), benefit: record })} />{record.status !== 'active' && <AdminInfo label="쿠폰 발급 조건" text="활성 상태이고 조건·기한이 확정돼야 쿠폰을 발급할 수 있어요." />}</>}</AdminDock>
          </>}
      </div>
    </dialog>
  </section>;
}

function Terms({ text, confirmed }: { text: string; confirmed: boolean }) {
  return <section className="partnership-detail-section"><h3>제공 조건 <span className="partnership-status">{confirmed ? '확정 기록' : '확인 중'}</span></h3><p className="partnership-copy">{text || '조건을 정리하고 있습니다.'}</p></section>;
}

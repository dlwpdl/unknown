import './admin-merchants.css';
import './admin-partner-workspace.css';
import './admin-merchant-detail.css';
import { AdminAiConnection } from './admin-ai-connection';
import { AdminMerchantCreators } from './admin-merchant-creators';
import { AdminMerchantConnections } from './admin-merchant-connections';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES, TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { AdminMerchantPost } from './admin-merchant-posts';
import { AdminMerchantReceiptQueue } from './admin-merchant-receipt-queue';
import { AdminFilterBar, AdminFilterReset, AdminSelect } from './admin-table-controls';
import { merchantContactLinks, merchantEventId, merchantPrimaryContactLink } from '@/lib/merchant-source';
import { setAdminMerchantOwner } from '@/lib/admin-merchants';
import { loadAdminProfilesByIds } from '@/lib/admin-data';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { MerchantProfileEditor } from '@/components/merchant-profile-editor';
import {
  createMerchantPost, deleteMerchants, linkMerchantPost, loadMerchant, loadMerchants, merchantReportHtml,
  merchantReportText, merchantMapsUrl, merchantAddressCity, merchantRegisteredDate, MERCHANT_DEFAULT_FILTERS, saveMerchant, saveMerchantReport,
  type Merchant, type MerchantDetail, type MerchantReport, type MerchantDirectoryFilters,
} from '@/lib/admin-merchants';

const STATUS = { lead: '연락 예정', trial: '무료 운영', paid: '유료 운영', paused: '중단' };
const CONSENT = { pending: '허락 대기', granted: '허락 받음', revoked: '허락 철회' };
type MerchantInput = Parameters<typeof saveMerchant>[1];
type ReportInput = Parameters<typeof saveMerchantReport>[1];
const DETAIL_TABS = [['overview', '개요'], ['profile', '프로필'], ['accounts', '계정 연결'], ['creators', '크리에이터 협업'], ['activity', '글·성과'], ['tools', '운영 도구']] as const;
type DetailTab = typeof DETAIL_TABS[number][0];
const emptyMerchant = (): MerchantInput => ({ id: merchantEventId(), record_kind: 'source', name: '', city_id: 'vancouver', industry: '', services: '', address: '', contact: '', status: 'lead', consent: 'pending', consent_note: '', trial_ends_at: null });
const errorMessage = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'MERCHANT_SELECTION_CHANGED') return '선택한 비즈니스 정보가 변경됐습니다. 목록을 새로 불러온 뒤 다시 선택해 주세요.';
  if (code === 'MERCHANT_PUBLISHING_IN_PROGRESS') return '외부 게시가 진행 중이거나 결과 확인이 필요한 비즈니스가 있습니다. 게시 결과를 확인한 뒤 다시 시도해 주세요.';
  if (code === 'MERCHANT_NOT_FOUND') return '삭제되었거나 찾을 수 없는 비즈니스입니다. 목록을 새로 불러와 주세요.';
  return ({ MERCHANT_CONSENT_REQUIRED: '게시 허락을 받은 범위와 기록을 먼저 입력해 주세요.', INVALID_ORIGINAL_URL: '비즈니스 계정 주소에는 공개된 HTTPS 페이지의 주소를 넣어주세요.', POST_ALREADY_LINKED: '이미 다른 비즈니스에 연결된 글입니다.', MERCHANT_CITY_LOCKED: '글이 연결된 비즈니스는 도시를 바꿀 수 없습니다.', INVALID_MERCHANT_PERIOD: '해당 도시의 오늘까지, 최근 90일 안의 기간을 선택해 주세요.', REPORT_PERIOD_LOCKED: '저장된 보고서의 기간은 고정됩니다. 새 보고서를 만들어 주세요.', CONTENT_REJECTED: '게시 기준에 맞지 않는 내용입니다. 원고를 확인해 주세요.', MERCHANT_KIND_HAS_HISTORY: '리뷰나 소유 계정이 있는 비즈니스는 대리등록으로 바꿀 수 없습니다. 기존 기록을 유지하고 별도 매물로 등록해 주세요.', ADMIN_REQUIRED: '관리자 권한을 확인한 뒤 다시 로그인해 주세요.' } as Record<string, string>)[code]
    ?? (code.includes('merchants_name_city_idx') ? '같은 도시에 등록된 비즈니스 이름입니다. 기존 비즈니스를 선택해 주세요.' : '저장하거나 불러오지 못했습니다. 입력은 유지했으니 연결 상태를 확인하고 다시 시도해 주세요.');
};
function periodFor(zone = 'America/Vancouver') {
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 13);
  return { start: date.toISOString().slice(0, 10), end };
}
const logoUri = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const contactLinks = (value: string, onClick: () => void) => merchantContactLinks(value).map((part, index) => part.href
  ? <a key={index} className="merchant-contact-link" href={part.href} target="_blank" rel="noopener noreferrer" aria-label={`${part.text} 열기 (새 탭)`} onClick={onClick}>{part.text} <span aria-hidden="true">↗</span></a>
  : part.text);

export function AdminMerchantsView({ refreshSignal, onUser, localPreview = false }: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  const { play } = useInteractionFeedback();
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [list, setList] = useState<{ key: string; rows: Merchant[]; more: boolean; total?: number; owners: Record<string, string> } | null>(null);
  const [editor, setEditor] = useState<MerchantInput | null>(null);
  const [period, setPeriod] = useState(periodFor);
  const [response, setResponse] = useState<{ key: string; data: MerchantDetail } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [postMode, setPostMode] = useState<'link' | 'create'>('link');
  const [postId, setPostId] = useState(''), [source, setSource] = useState('');
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [tag, setTag] = useState('life');
  const [kind, setKind] = useState<'story' | 'listing'>('story');
  const [postRequest, setPostRequest] = useState(merchantEventId);
  const [draft, setDraft] = useState<ReportInput | null>(null), [report, setReport] = useState<MerchantReport | null>(null);
  const [dirty, setDirty] = useState(false), [logo, setLogo] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false), [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [ownerDirty, setOwnerDirty] = useState(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [creatorDirty, setCreatorDirty] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), originalEditor = useRef<MerchantInput | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [listRevision, setListRevision] = useState(0);
  const [filters, setFilters] = useState<MerchantDirectoryFilters>(MERCHANT_DEFAULT_FILTERS);
  const [publicProfileOpen, setPublicProfileOpen] = useState(false), [publicProfileDirty, setPublicProfileDirty] = useState(false);
  const detailBody = useRef<HTMLDivElement>(null);
  const appliedFilters = Object.entries(filters).filter(([key, value]) => key !== 'sort' && value !== '').length;
  const listKey = `${query}:${page}:${revision}:${refreshSignal}:${listRevision}:${JSON.stringify(filters)}`;
  const detailKey = `${selected}:${period.start}:${period.end}:${revision}:${refreshSignal}`;
  const currentList = list?.key === listKey ? list : null;
  const checkedRows = currentList?.rows.filter((merchant) => checkedIds.includes(merchant.id)) ?? [];
  const allChecked = !!currentList?.rows.length && checkedRows.length === currentList.rows.length;
  const detail = response?.key === detailKey ? response.data : null;
  const connectionMerchant = response?.data.merchant.id === selected ? response.data.merchant : null;
  const editable = editor && selected && detail?.merchant.id === selected;
  const mapsUrl = editor ? merchantMapsUrl(editor.address ?? '') : null;

  useEffect(() => {
    if (panelOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!panelOpen && dialog.current?.open) dialog.current.close();
    if (detailBody.current) detailBody.current.scrollTop = 0;
  }, [panelOpen, selected]);

  useEffect(() => {
    let active = true;
    void loadMerchants(supabase, query, page * 50, filters)
      .then(async ({ merchants, more, total }) => {
        let owners: Record<string, string> = {};
        try {
          const profiles = await loadAdminProfilesByIds(supabase, merchants.map((m) => m.owner_id ?? ''));
          owners = Object.fromEntries(profiles.map((profile) => [profile.id, profile.nickname]));
        } catch { /* Connection state stays visible when a profile name cannot be read. */ }
        if (active) { setList({ key: listKey, rows: merchants, more, total, owners }); setCheckedIds([]); }
      })
      .catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [listKey, page, query, filters]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void loadMerchant(supabase, selected, period.start, period.end)
      .then((data) => { if (active) setResponse({ key: detailKey, data }); })
      .catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [detailKey, period.end, period.start, selected]);
  useEffect(() => {
    let active = true;
    void fetch(logoUri).then((r) => r.blob()).then((blob) => {
      const reader = new FileReader(); reader.onload = () => { if (active && typeof reader.result === 'string') setLogo(reader.result); }; reader.readAsDataURL(blob);
    }).catch(() => { /* Typographic wordmark remains available when an asset fails. */ });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>, success: string, refreshDetail = true) {
    if (busyRef.current) return;
    if (refreshDetail && connectionDirty && !window.confirm('입력 중인 계정 연결 내용을 버리고 다른 변경을 저장할까요?')) return;
    if (refreshDetail) setConnectionDirty(false);
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try { await action(); setNotice(success); play('selection'); if (refreshDetail) setRevision((v) => v + 1); else setListRevision((v) => v + 1); }
    catch (e) { setError(errorMessage(e)); play('warning'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function selectMerchant(merchant: Merchant, tab?: DetailTab) {
    if (busyRef.current) return;
    play('selection');
    if (selected === merchant.id && editor) {
      if (!hasUnsavedChanges()) { originalEditor.current = { ...merchant }; setEditor({ ...merchant }); }
      setPanelOpen(true); if (tab && tab !== detailTab) detailPage(tab); return;
    }
    if (!canReplaceEditor()) return;
    originalEditor.current = { ...merchant };
    setSelected(merchant.id); setEditor({ ...merchant }); setPeriod(periodFor(merchant.timezone));
    setPanelOpen(true); setDetailTab(tab ?? 'overview');
    setPublicProfileOpen(tab === 'profile'); setPublicProfileDirty(false);
    setOwnerDirty(false); setConnectionDirty(false); setCreatorDirty(false);
    setToolsOpen(false);
    setDraft(null); setReport(null); setDirty(false); setPostId(''); setSource(''); setTitle(''); setBody(''); setPostRequest(merchantEventId()); setError(''); setNotice('');
  }
  function hasUnsavedChanges() { return !!(publicProfileDirty || creatorDirty || ownerDirty || dirty || postId || source || title || body || (editor && JSON.stringify(editor) !== JSON.stringify(originalEditor.current))); }
  function canReplaceEditor() { return !hasUnsavedChanges() || window.confirm('저장하지 않은 내용이 있습니다. 다른 비즈니스를 열면 수정 내용이 사라집니다. 계속할까요?'); }
  function closePanel() {
    if (busyRef.current || creatorDirty && !window.confirm('저장하지 않은 크리에이터 연결 내용을 닫을까요?')) return;
    play('selection'); setPanelOpen(false); setCreatorDirty(false);
  }
  function detailPage(tab: DetailTab) {
    if (busyRef.current) return;
    play('selection');
    if (tab === detailTab || creatorDirty && !window.confirm('저장하지 않은 크리에이터 연결 내용을 닫고 다른 탭을 열까요?')) return;
    if (tab === 'profile') setPublicProfileOpen(true);
    if (tab === 'tools') setToolsOpen(true);
    setDetailTab(tab); setCreatorDirty(false);
    if (detailBody.current) detailBody.current.scrollTop = 0;
  }
  function changeFilters(next: MerchantDirectoryFilters) { setCheckedIds([]); setPage(0); setError(''); setFilters(next); }
  function removeMerchants(merchants: Merchant[]) {
    if (!merchants.length || busyRef.current) return;
    play('warning');
    const removesEditor = merchants.some((merchant) => merchant.id === selected);
    const message = `${merchants.length}개 비즈니스를 삭제할까요?\n\n${merchants.map((merchant) => `• ${merchant.name}`).join('\n')}\n\n비즈니스 목록과 공개 비즈니스 프로필에서 제외됩니다. 연결된 글·회원 계정·운영 기록은 보존됩니다.${removesEditor && hasUnsavedChanges() ? '\n이 비즈니스에서 저장하지 않은 수정 내용은 사라집니다.' : ''}`;
    if (!window.confirm(message)) return;
    void run(async () => {
      await deleteMerchants(supabase, merchants);
      setCheckedIds([]);
      if (removesEditor) {
        setPanelOpen(false); setSelected(null); setEditor(null); originalEditor.current = null; setResponse(null);
        setOwnerDirty(false); setConnectionDirty(false); setCreatorDirty(false); setDraft(null); setReport(null); setDirty(false);
        setPublicProfileOpen(false); setPublicProfileDirty(false);
        setPostId(''); setSource(''); setTitle(''); setBody('');
      }
      if (page && merchants.length === currentList?.rows.length) setPage((value) => value - 1);
    }, `${merchants.length}개 비즈니스를 삭제했습니다. 연결된 글과 계정은 보존했습니다.`, false);
  }
  function beginReport() {
    if (!detail || !selected) return;
    play('selection'); setReport(null); setDirty(true);
    setDraft({ id: merchantEventId(), merchant_id: selected, period_start: period.start, period_end: period.end,
      title: `${detail.merchant.name} 홍보 운영 보고서`, summary: '', next_step: '', proposal_period: 'month', proposal_amount: null, tax_note: '세금 별도' });
  }
  function changeDraft(next: Partial<ReportInput>) { if (draft) { setDraft({ ...draft, ...next }); setDirty(true); } }
  function openReport(saved: MerchantReport) {
    play('selection'); setReport(saved); setDirty(false);
    const { id, merchant_id, period_start, period_end, title, summary, next_step, proposal_period, proposal_amount, tax_note } = saved;
    setDraft({ id, merchant_id, period_start, period_end, title, summary, next_step, proposal_period, proposal_amount, tax_note });
  }
  function exportReport(print: boolean) {
    if (!report || dirty) return;
    play('selection'); const html = merchantReportHtml(report, logo);
    if (print) {
      const popup = window.open('', '_blank');
      if (!popup) { setError('새 창이 차단됐습니다. 팝업을 허용하거나 HTML 파일을 내려받아 인쇄해 주세요.'); return; }
      popup.document.write(html); popup.document.close();
      Promise.all(Array.from(popup.document.images).map((img) => img.decode().catch(() => {}))).then(() => { popup.focus(); popup.print(); });
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `gling-${report.merchant_name.replace(/[^\p{L}\p{N}-]/gu, '_')}-${report.period_end}.html`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return <section className="merchant-admin partner-workspace" aria-label="비즈니스 관리" aria-busy={busy}>
    <header className="merchant-heading"><div><h1>비즈니스 관리</h1><p>비즈니스 정보와 크리에이터 협업을 함께 관리합니다. 대리등록 자료에는 공개 비즈니스 프로필이 없습니다.</p></div>
      <button disabled={busy} className="merchant-primary" onClick={() => { play('selection'); if (!canReplaceEditor()) return; const value = emptyMerchant(); originalEditor.current = value; setSelected(null); setEditor(value); setPanelOpen(true); setDetailTab('profile'); setPublicProfileOpen(false); setPublicProfileDirty(false); setOwnerDirty(false); setConnectionDirty(false); setCreatorDirty(false); setDraft(null); setReport(null); setDirty(false); setPostId(''); setSource(''); setTitle(''); setBody(''); setNotice(''); setError(''); }}>비즈니스 등록</button></header>
    {error && !panelOpen && <div role="alert" className="merchant-message merchant-error">{error}<button disabled={busy} onClick={() => { play('selection'); setError(''); setListRevision((v) => v + 1); if (!hasUnsavedChanges()) setRevision((v) => v + 1); }}>다시 불러오기</button></div>}
    {notice && !panelOpen && <p role="status" className="merchant-message">{notice}</p>}
    <section className="merchant-directory" aria-label="비즈니스 목록">
      <div className="merchant-directory-toolbar"><form className="merchant-search" onSubmit={(e) => { e.preventDefault(); play('selection'); setCheckedIds([]); setPage(0); setQuery(input.trim()); setRevision((v) => v + 1); }}>
        <input aria-label="비즈니스 이름 또는 연락처 검색" placeholder="비즈니스 이름 · 연락처 검색" maxLength={120} onFocus={() => play('selection')} value={input} onChange={(e) => setInput(e.target.value)} /><button disabled={busy}>검색</button></form>
        <AdminSelect label="정렬" value={filters.sort} options={[{ value: 'name_asc', label: '이름 오름차순' }, { value: 'name_desc', label: '이름 내림차순' }, { value: 'created_desc', label: '최근 등록순' }, { value: 'created_asc', label: '오래된 등록순' }]} onChange={sort => changeFilters({ ...filters, sort: sort as MerchantDirectoryFilters['sort'] })} />
        <AdminFilterBar applied={appliedFilters}>
          <AdminSelect label="게시 지역" value={filters.city_id} options={[{ value: '', label: '전체 지역' }, ...CITIES.map(c => ({ value: c.id, label: c.name }))]} onChange={city_id => changeFilters({ ...filters, city_id })} />
          <AdminSelect label="운영 상태" value={filters.status} options={[{ value: '', label: '전체 상태' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} onChange={status => changeFilters({ ...filters, status: status as MerchantDirectoryFilters['status'] })} />
          <AdminSelect label="게시 허락" value={filters.consent} options={[{ value: '', label: '전체' }, ...Object.entries(CONSENT).map(([value, label]) => ({ value, label }))]} onChange={consent => changeFilters({ ...filters, consent: consent as MerchantDirectoryFilters['consent'] })} />
          <AdminSelect label="등록 종류" value={filters.record_kind} options={[{ value: '', label: '전체 종류' }, { value: 'business', label: '확인된 비즈니스' }, { value: 'source', label: '매물·홍보 대리등록' }]} onChange={record_kind => changeFilters({ ...filters, record_kind: record_kind as MerchantDirectoryFilters['record_kind'] })} />
          <AdminSelect label="글링 계정" value={filters.account} options={[{ value: '', label: '전체' }, { value: 'connected', label: '연결됨' }, { value: 'unconnected', label: '미연결' }]} onChange={account => changeFilters({ ...filters, account: account as MerchantDirectoryFilters['account'] })} />
          <AdminFilterReset disabled={!appliedFilters && !query && !input} onReset={() => { changeFilters({ ...MERCHANT_DEFAULT_FILTERS, sort: filters.sort }); setInput(''); setQuery(''); }} />
        </AdminFilterBar>
      </div>
      <div className="merchant-batch-actions" aria-label="선택한 비즈니스 관리">
        <label className="merchant-select"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allChecked} disabled={busy || !currentList?.rows.length} ref={(input) => { if (input) input.indeterminate = checkedRows.length > 0 && !allChecked; }} onChange={(event) => { play('selection'); setCheckedIds(event.target.checked ? currentList!.rows.map((merchant) => merchant.id) : []); }} />현재 페이지 전체 선택</label>
        <span role="status" aria-live="polite">{checkedRows.length}개 선택</span>
        <button type="button" disabled={busy || !checkedRows.length} onClick={() => { play('selection'); setCheckedIds([]); }}>선택 해제</button>
        <button type="button" className="merchant-danger" disabled={busy || !checkedRows.length} onClick={() => removeMerchants(checkedRows)}>선택 삭제</button>
      </div>
      {!currentList ? <p className="merchant-empty" role="status">{error ? '목록을 불러오지 못했습니다.' : '비즈니스를 불러오는 중…'}</p> : !currentList.rows.length ? <div className="merchant-empty"><h2>{query || appliedFilters ? '조건에 맞는 비즈니스가 없습니다' : '첫 비즈니스를 등록해 주세요'}</h2><p>{query || appliedFilters ? '검색어나 필터를 바꿔 주세요.' : '비즈니스가 게시를 허락하면 비즈니스 계정·웹사이트 주소와 함께 글을 연결할 수 있습니다.'}</p></div> : <div className="merchant-directory-scroll" tabIndex={0} aria-label="비즈니스 현황 표 · 가로로 스크롤할 수 있습니다"><table className="merchant-directory-table">
        <caption className="merchant-table-caption">{currentList.total !== undefined ? `조건에 맞는 비즈니스 ${currentList.total}개 · ` : ''}현재 목록 {currentList.rows.length}개{currentList.more ? ' · 다음 페이지에 더 있습니다' : ''}</caption>
        <thead><tr><th scope="col">선택</th><th scope="col">비즈니스·SNS</th><th scope="col">소재지</th><th scope="col">계정·등록일</th><th scope="col">운영·게시 허락</th><th scope="col">글·보고서</th><th scope="col">관리</th></tr></thead>
        <tbody>{currentList.rows.map((m) => { const primaryLink = merchantPrimaryContactLink(m.contact); return <tr key={m.id} data-selected={selected === m.id} data-checked={checkedIds.includes(m.id)} onClick={(e) => { if (!busy && !(e.target as HTMLElement).closest('a,button,input,label')) selectMerchant(m); }}>
          <td className="merchant-select-cell"><label className="merchant-select"><input type="checkbox" aria-label={`${m.name} 선택`} disabled={busy} checked={checkedIds.includes(m.id)} onChange={(event) => { play('selection'); setCheckedIds((ids) => event.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id)); }} /></label></td>
          <th scope="row" data-label="비즈니스"><button disabled={busy} aria-label={`${m.name} 활동과 정보 보기`} title={m.name} aria-pressed={selected === m.id} onClick={() => selectMerchant(m)}><strong>{m.name}</strong><small>{m.record_kind === 'source' ? '대리등록 · 비즈니스 프로필 없음' : m.industry || '확인된 비즈니스'}</small></button><div className="merchant-contact">{primaryLink ? <a className="merchant-contact-link" href={primaryLink.href} target="_blank" rel="noopener noreferrer" title={primaryLink.href} aria-label={`${m.name} ${primaryLink.text} 열기 (새 탭)`} onClick={() => play('selection')}><span>{primaryLink.text}</span><span aria-hidden="true">↗</span></a> : m.contact ? <button type="button" onClick={() => selectMerchant(m, 'profile')} disabled={busy}>연락처 보기</button> : <span>연락처 미등록</span>}</div></th>
          <td data-label="소재지" className="merchant-location"><span>{merchantAddressCity(m.address ?? '') ?? '주소 미확인'}</span><small>게시 지역: {m.city_name}</small></td>
          <td data-label="계정·등록일" className="merchant-account" data-connected={!!m.owner_id}><span>{m.owner_id ? currentList.owners[m.owner_id] || '연결됨' : '미연결'}</span><small>등록일 {m.created_at ? <time dateTime={m.created_at} title="비즈니스 도시 시간 기준 등록일">{merchantRegisteredDate(m)}</time> : '확인 중'}</small></td>
          <td data-label="운영·게시 허락"><span className="merchant-status" data-status={m.status}>{STATUS[m.status]}</span><small>{CONSENT[m.consent]}</small></td><td data-label="글·보고서" className="merchant-count"><strong>글 {m.post_count}</strong><small>보고서 {m.report_count}</small></td>
          <td data-label="관리"><div className="merchant-row-actions">{m.record_kind !== 'source' && <button type="button" aria-label={`${m.name} 크리에이터 협업`} disabled={busy} onClick={() => selectMerchant(m, 'creators')}>협업</button>}<button type="button" aria-label={`${m.name} 수정`} disabled={busy} onClick={() => selectMerchant(m, 'profile')}>수정</button><button type="button" aria-label={`${m.name} 삭제`} className="merchant-danger" disabled={busy} onClick={() => removeMerchants([m])}>삭제</button></div></td>
        </tr>; })}</tbody></table></div>}
      <nav className="merchant-pager" aria-label="비즈니스 목록 페이지"><button disabled={!page || busy} onClick={() => { play('selection'); setCheckedIds([]); setPage((p) => p - 1); }}>이전</button><span>{page + 1}페이지</span><button disabled={!currentList?.more || busy} onClick={() => { play('selection'); setCheckedIds([]); setPage((p) => p + 1); }}>다음</button></nav>
    </section>
    <details className="partner-ai-tools" onToggle={() => play('selection')}><summary>AI 작업 연결</summary><AdminAiConnection /></details>
    <details className="merchant-manual-link" onToggle={event => { play('selection'); setReceiptsOpen(event.currentTarget.open); }}>
      <summary style={{ minHeight: 44 }}>후기 증빙 검토</summary>
      {receiptsOpen && <AdminMerchantReceiptQueue refreshSignal={refreshSignal} onUser={onUser} localPreview={localPreview} />}
    </details>
    <dialog ref={dialog} className="merchant-dialog merchant-detail-panel" data-source={editor?.record_kind === 'source'} aria-labelledby="merchant-detail-title" onCancel={(e) => { e.preventDefault(); if (!busy) closePanel(); }}><div className="merchant-workspace">
      <div className="merchant-detail-chrome">
      <header className="merchant-detail-heading"><span className="merchant-detail-avatar" aria-hidden="true">{editor?.name.slice(0, 1).toLocaleUpperCase() || '+'}</span><div>
        <p className="merchant-detail-eyebrow">{selected ? editor?.record_kind === 'source' ? '대리등록 상세' : '비즈니스 상세' : '비즈니스 등록'}</p>
        <h2 id="merchant-detail-title" title={editor?.name}>{selected ? editor?.name : '등록 종류와 정보'}</h2>
        {selected && <><p className="merchant-detail-location">{[editor?.industry, merchantAddressCity(editor?.address ?? '') ?? '소재지 미확인', `게시 지역 ${CITIES.find((c) => c.id === editor?.city_id)?.name ?? ''}`].filter(Boolean).join(' · ')}</p>
          <div className="merchant-detail-statuses" aria-label="운영과 연결 상태">{detail ? <><span data-status={detail.merchant.status}>{STATUS[detail.merchant.status]}</span><span data-positive={detail.merchant.consent === 'granted'}>{CONSENT[detail.merchant.consent]}</span>{detail.merchant.record_kind !== 'source' && <span data-positive={!!detail.merchant.owner_id}>{detail.merchant.owner_id ? '계정 연결됨' : '계정 미연결'}</span>}</> : <span role="status">상태 확인 중…</span>}</div>
          <div className="merchant-detail-meta"><details className="partner-contact-disclosure" onToggle={() => play('selection')}><summary>연락처·SNS</summary><p>{contactLinks(editor?.contact || '연락처 미등록', () => play('selection'))}</p></details></div>
        </>}
      </div><button type="button" className="merchant-detail-close" disabled={busy} aria-label="비즈니스 상세 닫기" onClick={closePanel}><span aria-hidden="true">×</span></button></header>
      {selected && <nav className="merchant-detail-nav" aria-label="비즈니스 상세 화면">{DETAIL_TABS.filter(([id]) => editor?.record_kind !== 'source' || ['overview', 'profile', 'activity'].includes(id)).map(([id, label]) => <button key={id} type="button" disabled={busy} aria-controls={`merchant-${id}-panel`} aria-pressed={detailTab === id} onClick={() => detailPage(id)}>{id === 'profile' && editor?.record_kind === 'source' ? '등록 정보' : label}</button>)}</nav>}
      </div>
      <div className="merchant-detail-body" ref={detailBody}>
      {error && <div role="alert" className="merchant-message merchant-error">{error}<button disabled={busy} onClick={() => { play('selection'); setError(''); setRevision((v) => v + 1); }}>다시 불러오기</button></div>}
      {notice && <p role="status" className="merchant-message">{notice}</p>}
      {selected && detailTab === 'overview' && <section id="merchant-overview-panel" aria-label="비즈니스 개요">
        <div className="merchant-detail-intro"><h2>{editor?.record_kind === 'source' ? '대리등록 개요' : '비즈니스 개요'}</h2><p>연결 상태와 등록 정보를 확인하고 필요한 작업으로 이동하세요.</p></div>
        {!detail ? <p className="merchant-empty" role="status">{error ? '비즈니스 정보를 불러오지 못했습니다.' : '비즈니스 정보를 불러오는 중…'}</p> : <>
          <dl className="merchant-detail-summary"><div><dt>{detail.merchant.record_kind === 'source' ? '등록 종류' : '연결 계정'}</dt><dd className="merchant-detail-summary-text">{detail.merchant.record_kind === 'source' ? '대리등록 자료' : detail.merchant.owner_id ? '소유자 연결됨' : '계정 미연결'}</dd><small>{detail.merchant.record_kind === 'source' ? '공개 프로필 없음' : detail.merchant.owner_verified_at ? '소유 확인 완료' : '소유 확인 대기'}</small></div><div><dt>연결된 글</dt><dd>{detail.merchant.post_count}<small>등록된 안내글</small></dd></div><div><dt>저장한 보고서</dt><dd>{detail.merchant.report_count}<small>등록된 보고서</small></dd></div></dl>
          {detail.merchant.record_kind !== 'source' && <section className="merchant-detail-section"><h3>주요 관리</h3><div className="merchant-detail-rows">
            <div className="merchant-detail-row"><span className="merchant-detail-icon" aria-hidden="true">▣</span><div><strong>공개 비즈니스 프로필</strong><p>로고·배너와 공개 정보를 확인합니다.</p></div><button type="button" disabled={busy} onClick={() => detailPage('profile')}>프로필 관리</button></div>
            <div className="merchant-detail-row"><span className="merchant-detail-icon" aria-hidden="true">♧</span><div><strong>{detail.merchant.owner_id ? '계정 연결됨' : '계정 미연결'}</strong><p>소유자와 운영 담당자의 권한을 관리합니다.</p></div><button type="button" disabled={busy} onClick={() => detailPage('accounts')}>계정 관리</button></div>
            <div className="merchant-detail-row"><span className="merchant-detail-icon" aria-hidden="true">↔</span><div><strong>크리에이터 협업 이력</strong><p>약속한 날짜·비용·콘텐츠를 확인합니다.</p></div><button type="button" disabled={busy} onClick={() => detailPage('creators')}>이력 보기</button></div>
          </div></section>}
          <section className="merchant-detail-section"><header><h3>등록 정보</h3><button type="button" className="merchant-detail-text-action" disabled={busy} onClick={() => detailPage('profile')}>정보 수정 →</button></header><dl className="merchant-detail-facts"><dt>업종</dt><dd>{detail.merchant.industry || '미등록'}</dd><dt>소재지</dt><dd>{detail.merchant.address || '주소 미확인'}</dd><dt>게시 지역</dt><dd>{detail.merchant.city_name}</dd><dt>등록일</dt><dd>{merchantRegisteredDate(detail.merchant)}</dd><dt>게시 허락</dt><dd>{CONSENT[detail.merchant.consent]}</dd></dl></section>
        </>}
      </section>}
      {panelOpen && detailTab === 'creators' && connectionMerchant && <section id="merchant-creators-panel" aria-label="크리에이터 협업"><AdminMerchantCreators key={connectionMerchant.id} merchant={connectionMerchant} onDirty={setCreatorDirty} onBusy={value => { busyRef.current = value; setBusy(value); }} /></section>}
      <section id="merchant-accounts-panel" hidden={detailTab !== 'accounts'} aria-label="계정 연결">
        <div className="merchant-detail-intro"><h2>계정 연결</h2><p>비즈니스를 관리할 계정과 소유 확인 상태를 관리합니다.</p></div>
      {connectionMerchant && connectionMerchant.record_kind !== 'source' && <section className="merchant-section">
        <h2>글링 계정 연결 관리</h2>
        <AdminMerchantConnections key={connectionMerchant.id + ":" + connectionMerchant.updated_at} merchant={connectionMerchant} busy={busy} onDirty={dirty => { setOwnerDirty(dirty); setConnectionDirty(dirty); }} onChanged={() => { setOwnerDirty(false); setConnectionDirty(false); setCreatorDirty(false); setRevision(v => v + 1); }} />
      </section>}
      {detail?.merchant.owner_id && detail.merchant.record_kind !== 'source' && <section className="merchant-section">
        <h2>소유 확인 · 비즈니스 이용 기간</h2>
        <MerchantOwnerForm key={`${detail.merchant.id}:${detail.merchant.updated_at}`} merchant={detail.merchant} ownerName={currentList?.owners[detail.merchant.owner_id ?? '']} busy={busy} onDirty={() => setOwnerDirty(true)} save={(owner, verified, until) => { void run(async () => { await setAdminMerchantOwner(supabase, selected!, owner, verified, until); setOwnerDirty(false); }, '비즈니스 소유 확인과 이용 기간을 저장했습니다.'); }} />
      </section>}
      </section>
      <div id="merchant-profile-panel" hidden={detailTab !== 'profile'}>
      <div className="merchant-detail-intro"><h2>{editor?.record_kind === 'source' || !selected ? '등록 정보' : '비즈니스 프로필'}</h2><p>{editor?.record_kind === 'source' ? '대리등록 자료의 정보와 게시 허락을 관리합니다.' : '공개 프로필과 관리자 등록 정보를 함께 확인합니다.'}</p></div>
      {publicProfileOpen && selected && editor?.record_kind !== 'source' && <section className="merchant-section merchant-detail-public-profile"><h2>공개 프로필</h2><MerchantProfileEditor key={selected} merchantId={selected} onDirty={setPublicProfileDirty} /></section>}
      {editor && <form className="merchant-section" onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const value: MerchantInput = { id: editor.id, record_kind: editor.record_kind ?? 'business', name: editor.name, city_id: editor.city_id, industry: editor.industry ?? '', services: editor.services ?? '', address: editor.address ?? '', contact: editor.contact, status: editor.status, consent: editor.consent, consent_note: editor.consent_note, trial_ends_at: editor.trial_ends_at };
        const id = await saveMerchant(supabase, value); originalEditor.current = { ...value, id }; setEditor({ ...value, id }); setSelected(id); setPeriod(periodFor(CITY_ZONE[editor.city_id]));
      }, '비즈니스 정보를 저장했습니다.'); }}>
        <fieldset disabled={busy}><div className="merchant-profile-group"><h3>기본 정보</h3><div className="merchant-fields">
          <label>등록 종류<select aria-label="등록 종류" value={editor.record_kind ?? 'business'} onChange={e => { play('selection'); setEditor({ ...editor, record_kind: e.target.value as Merchant['record_kind'] }); }}><option value="source">매물·홍보 대리등록</option><option value="business">확인된 비즈니스</option></select><small>{editor.record_kind === 'source' ? '공개 비즈니스 프로필과 비즈니스 리뷰를 만들지 않습니다.' : '실제 비즈니스명을 확인하고 기존 회사가 있으면 재사용하세요.'}</small></label>
          <label>{editor.record_kind === 'source' ? '매물·홍보 이름' : '비즈니스 이름'}<input onFocus={() => play('selection')} required maxLength={120} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
          <label><span>업종 <small>선택</small></span><input maxLength={80} placeholder="예: 카페, 미용실, 세무·회계" value={editor.industry ?? ''} onFocus={() => play('selection')} onChange={(e) => setEditor({ ...editor, industry: e.target.value })} /></label>
        </div><label><span>제공하는 서비스 <small>선택</small></span><textarea maxLength={1500} rows={3} placeholder="주요 메뉴·상품·서비스와 비즈니스의 특징을 적어 주세요." value={editor.services ?? ''} onFocus={() => play('selection')} onChange={(e) => setEditor({ ...editor, services: e.target.value })} /></label></div>
        <div className="merchant-profile-group"><h3>위치</h3><div className="merchant-fields">
          <label>게시 지역<select value={editor.city_id} disabled={!!detail?.merchant.post_count} onChange={(e) => { play('selection'); setEditor({ ...editor, city_id: e.target.value }); }}>{CITIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>상세 주소 <small>선택</small></span><input autoComplete="street-address" maxLength={300} placeholder="77 Finch Ave W, North York, ON M2N 2H5" value={editor.address ?? ''} onFocus={() => play('selection')} onChange={(e) => setEditor({ ...editor, address: e.target.value })} /></label>
        </div><p className="merchant-hint">소재지: {merchantAddressCity(editor.address ?? '') ?? '주소 미확인'} · 주소의 도시와 주를 표시합니다. 게시 지역은 글이 올라가는 커뮤니티입니다.</p>{mapsUrl ? <a className="merchant-map-link" href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>Google Maps에서 주소 보기 ↗</a> : <p className="merchant-hint">상세 주소를 입력하면 Google Maps에서 위치를 열 수 있습니다.</p>}
        {detail?.merchant.post_count ? <p className="merchant-hint">연결된 글이 있어 도시는 고정됩니다. 상세 주소는 수정할 수 있습니다.</p> : null}</div>
        <div className="merchant-profile-group"><h3>운영·게시 허락</h3><div className="merchant-fields">
          <label>운영 상태<select value={editor.status} onChange={(e) => { play('selection'); setEditor({ ...editor, status: e.target.value as Merchant['status'] }); }}>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>게시 허락<select value={editor.consent} onChange={(e) => { play('selection'); setEditor({ ...editor, consent: e.target.value as Merchant['consent'] }); }}>{Object.entries(CONSENT).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>무료 운영 종료일<input type="date" value={editor.trial_ends_at ?? ''} onChange={(e) => { play('selection'); setEditor({ ...editor, trial_ends_at: e.target.value || null }); }} /></label>
          <label>담당자 · 연락처<input onFocus={() => play('selection')} maxLength={1000} value={editor.contact} onChange={(e) => setEditor({ ...editor, contact: e.target.value })} /></label>
        </div><label>허락 받은 범위와 기록<textarea onFocus={() => play('selection')} required={editor.consent === 'granted'} maxLength={3000} rows={3} placeholder="허락 받은 날짜, 원고·사진과 게시 범위, 대화 기록 위치" value={editor.consent_note} onChange={(e) => setEditor({ ...editor, consent_note: e.target.value })} /></label></div>
        <div className="merchant-actions"><button className="merchant-primary">{busy ? '저장 중…' : '비즈니스 정보 저장'}</button>{!selected && <button type="button" onClick={closePanel}>취소</button>}</div></fieldset>
      </form>}

      </div>
      {selected && <div id="merchant-activity-panel" hidden={detailTab !== 'activity'}>
        <div className="merchant-detail-intro"><h2>글·성과</h2><p>연결된 글과 기간별 반응, 저장한 보고서를 확인합니다.</p></div>
      {selected && detail && <>
          <section className="merchant-section"><h2>연결된 글 · 사진 <span>{detail.merchant.post_count}편</span></h2>
            <p className="merchant-hint">비즈니스 계정에서 게시한 글과 대행 작성한 글을 함께 모았습니다. 선택한 종료일 기준입니다.</p>
            {!detail.posts.length ? <p className="merchant-hint">아직 연결된 글이 없습니다. 비즈니스 계정에서 게시하거나 기존 글을 개별 연결해 주세요.</p> : <div className="merchant-linked-posts">{detail.posts.map((post) => <AdminMerchantPost key={`${selected}:${post.post_id}`} merchantId={selected!} ownerId={detail.merchant.owner_id} linked={post} />)}</div>}
            {detail.merchant.consent !== 'granted' ? <p className="merchant-hint">게시 허락을 저장하면 글을 연결하거나 대신 작성할 수 있습니다.</p> : <details className="merchant-manual-link" onToggle={() => play('selection')}><summary>대행 작성 · 개별 글 연결</summary><p className="merchant-hint">계정 연결을 기본으로 사용합니다. 운영자 등 다른 계정이 작성한 글은 여기서 연결할 수 있습니다. 글의 실제 작성자는 그대로 유지됩니다.</p><form onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (postMode === 'link') await linkMerchantPost(supabase, selected, postId, source);
              else await createMerchantPost(supabase, selected, { title, body, tag_slug: tag, original_url: source, kind, request_id: postRequest });
              setPostId(''); setSource(''); setTitle(''); setBody(''); setPostRequest(merchantEventId());
            }, postMode === 'link' ? '글과 비즈니스 계정·웹사이트 주소를 연결했습니다.' : '글링에 비즈니스 안내를 게시하고 연결했습니다.'); }}>
              <fieldset disabled={busy || !editable}><div className="merchant-actions"><button type="button" aria-pressed={postMode === 'link'} onClick={() => { play('selection'); setPostMode('link'); }}>기존 글 연결</button><button type="button" aria-pressed={postMode === 'create'} onClick={() => { play('selection'); setPostMode('create'); }}>새 안내글 작성</button></div>
              {postMode === 'link' ? <label>글 선택<select required value={postId} onChange={(e) => { play('selection'); setPostId(e.target.value); setSource(detail.posts.find((p) => p.post_id === e.target.value)?.original_url ?? ''); }}><option value="">같은 도시의 최근 글을 선택하세요</option>{detail.available_posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label> : <>
                <div className="merchant-fields"><label>게시 분류<select value={kind} onChange={(e) => { play('selection'); setKind(e.target.value as 'story' | 'listing'); }}><option value="story">이야기 · 비즈니스 안내</option><option value="listing">구인구직 · 거래</option></select></label><label>주제<select value={tag} onChange={(e) => { play('selection'); setTag(e.target.value); }}>{TAGS.filter((t) => t.kind === 'post').map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label></div>
                <label>제목<input required value={title} maxLength={100} onFocus={() => play('selection')} onChange={(e) => setTitle(e.target.value)} /></label><label>비즈니스가 허락한 원고<textarea required value={body} maxLength={4700} rows={6} onFocus={() => play('selection')} onChange={(e) => setBody(e.target.value)} /></label><p className="merchant-hint">등록하면 글링에 바로 게시됩니다. 비즈니스가 허락한 대행 안내라는 문구가 함께 들어갑니다.</p>
              </>}
              <label>비즈니스 계정·웹사이트 주소<input required type="url" placeholder="https://" value={source} maxLength={2048} onFocus={() => play('selection')} onChange={(e) => setSource(e.target.value)} /></label>
              <p className="merchant-hint">무료·유료 운영 중인 비즈니스의 글에 ‘비즈니스 계정으로 가기’ 버튼이 표시됩니다.</p>
              <button className="merchant-primary">{postMode === 'link' ? '글 연결' : '글링에 게시'}</button></fieldset>
            </form></details>}
          </section>
      </>}
        <form className="merchant-period" onSubmit={(e) => e.preventDefault()}><h2>기간별 성과</h2><div className="merchant-fields">
          <label>시작일<input type="date" disabled={busy} value={period.start} max={period.end} onChange={(e) => { if (e.target.value) { play('selection'); setPeriod({ ...period, start: e.target.value }); } }} /></label>
          <label>종료일<input type="date" disabled={busy} value={period.end} min={period.start} max={periodFor(detail?.merchant.timezone).end} onChange={(e) => { if (e.target.value) { play('selection'); setPeriod({ ...period, end: e.target.value }); } }} /></label>
        </div><p>비즈니스 도시 시간 기준 · 최근 90일 · 조회 기록은 비즈니스 연결 이후부터 집계</p></form>
        {!detail ? <p className="merchant-empty" role="status">{error ? '성과를 불러오지 못했습니다.' : '성과를 불러오는 중…'}</p> : <>
          <dl className="merchant-metrics">
            <div><dt>연결된 글</dt><dd>{detail.metrics.linked_posts}편</dd><small>기간 내 새 글 {detail.metrics.new_posts}편</small></div>
            <div><dt>누적 표시 조회수</dt><dd>{detail.metrics.displayed_views.toLocaleString('ko-KR')}회</dd><small>현재 값 · 익명 조회·운영 조정 포함</small></div>
            <div><dt>기간 내 최초 열람</dt><dd>{detail.metrics.first_reads.toLocaleString('ko-KR')}회</dd><small>로그인 회원 {detail.metrics.unique_readers}명 · 재방문 제외</small></div>
            <div><dt>기간 내 비즈니스 링크 클릭</dt><dd>{detail.metrics.source_clicks.toLocaleString('ko-KR')}회</dd><small>외부 이동 버튼을 누른 기록</small></div>
            <div><dt>비즈니스 링크를 누른 로그인 회원</dt><dd>{detail.metrics.member_clickers}명</dd><small>관리자·작성자·시드 계정 제외</small></div>
            <div><dt>비즈니스 링크를 누른 익명 세션</dt><dd>{detail.metrics.anonymous_sessions}개</dd><small>실제 인원 수와 다를 수 있음</small></div>
          </dl>
          <section className="merchant-section"><div className="merchant-heading"><h2>보고서와 운영 제안</h2><button disabled={busy} onClick={beginReport}>새 보고서 작성</button></div>
            {detail.reports.length > 0 && <label>저장한 보고서<select disabled={busy} value={report?.id ?? ''} onChange={(e) => { const saved = detail.reports.find((r) => r.id === e.target.value); if (saved) openReport(saved); }}><option value="">보고서를 선택하세요</option>{detail.reports.map((r) => <option key={r.id} value={r.id}>{r.period_start}~{r.period_end} · {r.title}</option>)}</select></label>}
            {!draft ? <p className="merchant-hint">선택한 기간의 수치를 보고서에 담고, 다음 운영 내용과 금액을 작성할 수 있습니다.</p> : <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const saved = await saveMerchantReport(supabase, draft); setReport(saved); setDirty(false); }, '보고서를 저장했습니다. HTML 또는 PDF로 내보낼 수 있습니다.'); }}>
              <p className="merchant-hint">{draft.period_start}~{draft.period_end} · {report ? '저장 당시 수치 고정 · 설명과 제안 수정 가능' : '처음 저장할 때 서버에서 수치를 확정합니다.'}</p>
              <fieldset disabled={busy}><label>보고서 제목<input required maxLength={160} value={draft.title} onChange={(e) => changeDraft({ title: e.target.value })} /></label>
              <label>운영 결과 설명<textarea rows={4} maxLength={5000} placeholder="소개한 내용과 확인된 반응을 작성하세요." value={draft.summary} onChange={(e) => changeDraft({ summary: e.target.value })} /></label>
              <label>다음 운영 제안<textarea rows={4} maxLength={3000} placeholder="앞으로 소개할 글의 주제·횟수·기간 등 비즈니스에 제안할 내용을 작성하세요." value={draft.next_step} onChange={(e) => changeDraft({ next_step: e.target.value })} /></label>
              <div className="merchant-fields"><label>운영 기간<select value={draft.proposal_period} onChange={(e) => { play('selection'); changeDraft({ proposal_period: e.target.value as 'month' | 'two_weeks' }); }}><option value="two_weeks">2주</option><option value="month">1개월</option></select></label>
                <label>제안 금액 · CAD<input type="number" min="0" max="99999999" step="0.01" placeholder="미입력 시 금액 생략" value={draft.proposal_amount ?? ''} onChange={(e) => changeDraft({ proposal_amount: e.target.value === '' ? null : Number(e.target.value) })} /></label></div>
              <label>세금 · 견적 안내<input maxLength={300} value={draft.tax_note} onChange={(e) => changeDraft({ tax_note: e.target.value })} /></label>
              <button className="merchant-primary">{busy ? '저장 중…' : report ? '보고서 수정 저장' : '보고서 저장'}</button></fieldset>
            </form>}
            {report && <><div className="merchant-actions"><button disabled={busy || dirty} onClick={() => exportReport(false)}>HTML 다운로드</button><button disabled={busy || dirty} onClick={() => exportReport(true)}>PDF로 저장 · 인쇄</button><button disabled={busy || dirty} onClick={() => { play('selection'); void navigator.clipboard.writeText(merchantReportText(report)).then(() => setNotice('보고서 내용을 복사했습니다.')).catch(() => setError('복사하지 못했습니다. HTML 파일을 내려받아 주세요.')); }}>텍스트 복사</button></div>{dirty && <p className="merchant-hint">수정한 내용을 저장한 뒤 내보내세요.</p>}
              <details onToggle={() => play('selection')}><summary>저장된 보고서 미리보기</summary><iframe title="비즈니스 전달용 보고서" sandbox="" srcDoc={merchantReportHtml(report, logo)} /></details></>}
          </section>
        </>}
      </div>}
      {selected && editor?.record_kind !== 'source' && <section id="merchant-tools-panel" hidden={detailTab !== 'tools'} aria-label="운영 도구"><div className="merchant-detail-intro"><h2>운영 도구</h2><p>초안·채널·재고 등 비즈니스 운영 작업을 엽니다. 기존 관리 권한을 적용합니다.</p></div>{toolsOpen && <MerchantWorkspace merchantId={selected} refreshSignal={revision + refreshSignal} />}</section>}
      </div>
    </div></dialog>
  </section>;
}

function MerchantOwnerForm({ merchant, ownerName, busy, save, onDirty }: { merchant: Merchant; ownerName?: string; busy: boolean; save: (owner: string, verified: boolean, until: string | null) => void; onDirty: () => void }) {
  const { play } = useInteractionFeedback();
  const [owner, setOwner] = useState(merchant.owner_id ?? ''), [verified, setVerified] = useState(!!merchant.owner_verified_at), [until, setUntil] = useState(merchant.workspace_until ?? '');
  return <form className="merchant-section" onSubmit={(e) => { e.preventDefault(); play('selection'); save(owner.trim(), verified, until || null); }}>
    <p className="merchant-account-summary">{ownerName || (merchant.owner_id ? '연결됨 · 이름 확인 필요' : '미연결')}</p><p className="merchant-hint">이 비즈니스를 관리하는 글링 계정입니다. 연결된 계정의 비즈니스 도구에서 게시한 글은 비즈니스에 자동 연결됩니다. 다른 계정으로 작성한 글은 아래에서 개별 연결할 수 있습니다.</p><fieldset disabled={busy}><label>비즈니스 소유자 · 글링 회원 ID<input onFocus={() => play('selection')} required readOnly={!!merchant.owner_id} pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}" value={owner} onChange={(e) => { setOwner(e.target.value); onDirty(); }} /></label>
      <label className="merchant-owner-check"><input type="checkbox" checked={verified} onChange={(e) => { play('selection'); setVerified(e.target.checked); onDirty(); }} />비즈니스 소유 확인 완료</label><p className="merchant-hint">실제 담당자와 확인한 뒤 표시해 주세요. 회원이 비즈니스를 등록한 것만으로 소유를 인증하지 않습니다.</p>
      <label>비즈니스 유료 운영 종료일<input type="date" value={until} min={periodFor(merchant.timezone).end} onChange={(e) => { play('selection'); setUntil(e.target.value); onDirty(); }} /></label><p className="merchant-hint">유료 운영 상태와 유효한 종료일이 모두 있어야 일괄 도구를 이용합니다. 날짜를 비우면 유료 권한을 해제하며 자동 결제는 실행하지 않습니다.</p>
      <button type="submit">소유 확인 · 이용 기간 저장</button>
    </fieldset>
  </form>;
}
const CITY_ZONE: Record<string, string> = { toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto', calgary: 'America/Edmonton', edmonton: 'America/Edmonton', winnipeg: 'America/Winnipeg', saskatoon: 'America/Regina', regina: 'America/Regina', 'saint-john': 'America/Moncton', halifax: 'America/Halifax' };

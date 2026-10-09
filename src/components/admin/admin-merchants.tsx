import './admin-merchants.css';
import { AdminAiConnection } from './admin-ai-connection';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES, TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { buildSharedPostUrl } from '@/lib/sharing';
import { merchantEventId } from '@/lib/merchant-source';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import {
  setAdminMerchantOwner, createMerchantPost, linkMerchantPost, loadMerchant, loadMerchants, merchantReportHtml,
  merchantReportText, saveMerchant, saveMerchantReport,
  type Merchant, type MerchantDetail, type MerchantReport,
} from '@/lib/admin-merchants';

const STATUS = { lead: '연락 예정', trial: '무료 운영', paid: '유료 운영', paused: '중단' };
const CONSENT = { pending: '허락 대기', granted: '허락 받음', revoked: '허락 철회' };
type MerchantInput = Parameters<typeof saveMerchant>[1];
type ReportInput = Parameters<typeof saveMerchantReport>[1];
const emptyMerchant = (): MerchantInput => ({ id: merchantEventId(), name: '', city_id: 'vancouver', contact: '', status: 'lead', consent: 'pending', consent_note: '', trial_ends_at: null });
const errorMessage = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  return ({ MERCHANT_CONSENT_REQUIRED: '게시 허락을 받은 범위와 기록을 먼저 입력해 주세요.', INVALID_ORIGINAL_URL: '업체 계정 주소에는 공개된 HTTPS 페이지의 주소를 넣어주세요.', POST_ALREADY_LINKED: '이미 다른 업체에 연결된 글입니다.', MERCHANT_CITY_LOCKED: '글이 연결된 업체는 도시를 바꿀 수 없습니다.', INVALID_MERCHANT_PERIOD: '해당 도시의 오늘까지, 최근 90일 안의 기간을 선택해 주세요.', REPORT_PERIOD_LOCKED: '저장된 보고서의 기간은 고정됩니다. 새 보고서를 만들어 주세요.', CONTENT_REJECTED: '게시 기준에 맞지 않는 내용입니다. 원고를 확인해 주세요.', ADMIN_REQUIRED: '관리자 권한을 확인한 뒤 다시 로그인해 주세요.' } as Record<string, string>)[code]
    ?? (code.includes('merchants_name_city_idx') ? '같은 도시에 등록된 업체 이름입니다. 기존 업체를 선택해 주세요.' : '저장하거나 불러오지 못했습니다. 입력은 유지했으니 연결 상태를 확인하고 다시 시도해 주세요.');
};
function periodFor(zone = 'America/Vancouver') {
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 13);
  return { start: date.toISOString().slice(0, 10), end };
}
const logoUri = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;

export function AdminMerchantsView({ refreshSignal }: { refreshSignal: number }) {
  const { play } = useInteractionFeedback();
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [list, setList] = useState<{ key: string; rows: Merchant[]; more: boolean } | null>(null);
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
  const listKey = `${query}:${page}:${revision}:${refreshSignal}`;
  const detailKey = `${selected}:${period.start}:${period.end}:${revision}:${refreshSignal}`;
  const currentList = list?.key === listKey ? list : null;
  const detail = response?.key === detailKey ? response.data : null;
  const editable = editor && selected && detail?.merchant.id === selected;

  useEffect(() => {
    let active = true;
    void loadMerchants(supabase, query, page * 50)
      .then(({ merchants, more }) => { if (active) setList({ key: listKey, rows: merchants, more }); })
      .catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [listKey, page, query]);
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

  async function run(action: () => Promise<void>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try { await action(); setNotice(success); play('selection'); setRevision((v) => v + 1); }
    catch (e) { setError(errorMessage(e)); play('warning'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function selectMerchant(merchant: Merchant) {
    play('selection'); setSelected(merchant.id); setEditor({ ...merchant }); setPeriod(periodFor(merchant.timezone));
    setToolsOpen(false);
    setDraft(null); setReport(null); setDirty(false); setPostId(''); setSource(''); setTitle(''); setBody(''); setPostRequest(merchantEventId()); setError(''); setNotice('');
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

  return <section className="merchant-admin" aria-label="업체 관리" aria-busy={busy}>
    <header className="merchant-heading"><div><h1>업체 관리</h1><p>게시 허락부터 소개한 글, 성과 보고서와 다음 운영 제안까지.</p></div>
      <button disabled={busy} className={!editor ? 'merchant-primary' : undefined} onClick={() => { play('selection'); setSelected(null); setEditor(emptyMerchant()); setDraft(null); setReport(null); setNotice(''); setError(''); }}>업체 등록</button></header>
    <AdminAiConnection />
    {error && <div role="alert" className="merchant-message merchant-error">{error}<button disabled={busy} onClick={() => { play('selection'); setError(''); setRevision((v) => v + 1); }}>다시 불러오기</button></div>}
    {notice && <p role="status" className="merchant-message">{notice}</p>}
    <div className="merchant-layout"><aside aria-label="업체 목록">
      <form className="merchant-search" onSubmit={(e) => { e.preventDefault(); play('selection'); setPage(0); setQuery(input.trim()); setRevision((v) => v + 1); }}>
        <input aria-label="업체 이름 또는 연락처 검색" placeholder="업체 이름 · 연락처 검색" maxLength={120} value={input} onChange={(e) => setInput(e.target.value)} /><button disabled={busy}>검색</button></form>
      {!currentList ? <p className="merchant-empty" role="status">{error ? '목록을 불러오지 못했습니다.' : '업체를 불러오는 중…'}</p> : !currentList.rows.length ? <div className="merchant-empty"><h2>{query ? '검색 결과가 없습니다' : '첫 업체를 등록해 주세요'}</h2><p>{query ? '다른 이름이나 연락처로 검색해 주세요.' : '업체가 게시를 허락하면 업체 계정·웹사이트 주소와 함께 글을 연결할 수 있습니다.'}</p></div> : <ul className="merchant-list">{currentList.rows.map((m) => <li key={m.id}><button disabled={busy} aria-pressed={selected === m.id} onClick={() => selectMerchant(m)}><strong>{m.name}</strong><span>{m.city_name} · {STATUS[m.status]}</span><small>{CONSENT[m.consent]} · 글 {m.post_count}편 · 보고서 {m.report_count}개</small></button></li>)}</ul>}
      <nav className="merchant-pager" aria-label="업체 목록 페이지"><button disabled={!page || busy} onClick={() => { play('selection'); setPage((p) => p - 1); }}>이전</button><span>{page + 1}페이지</span><button disabled={!currentList?.more || busy} onClick={() => { play('selection'); setPage((p) => p + 1); }}>다음</button></nav>
    </aside><div className="merchant-workspace">
      {!editor && <div className="merchant-empty"><h2>업체를 선택해 주세요</h2><p>등록된 업체의 글과 성과를 확인하거나 새 업체를 등록할 수 있습니다.</p></div>}
      {editor && <form className="merchant-section" onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const value: MerchantInput = { id: editor.id, name: editor.name, city_id: editor.city_id, contact: editor.contact, status: editor.status, consent: editor.consent, consent_note: editor.consent_note, trial_ends_at: editor.trial_ends_at };
        const id = await saveMerchant(supabase, value); setEditor({ ...value, id }); setSelected(id); setPeriod(periodFor(CITY_ZONE[editor.city_id]));
      }, '업체 정보를 저장했습니다.'); }}>
        <h2>{selected ? editor.name : '새 업체'}</h2><fieldset disabled={busy}><div className="merchant-fields">
          <label>업체 이름<input required maxLength={120} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
          <label>도시<select value={editor.city_id} disabled={!!detail?.merchant.post_count} onChange={(e) => { play('selection'); setEditor({ ...editor, city_id: e.target.value }); }}>{CITIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>운영 상태<select value={editor.status} onChange={(e) => { play('selection'); setEditor({ ...editor, status: e.target.value as Merchant['status'] }); }}>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>게시 허락<select value={editor.consent} onChange={(e) => { play('selection'); setEditor({ ...editor, consent: e.target.value as Merchant['consent'] }); }}>{Object.entries(CONSENT).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>무료 운영 종료일<input type="date" value={editor.trial_ends_at ?? ''} onChange={(e) => { play('selection'); setEditor({ ...editor, trial_ends_at: e.target.value || null }); }} /></label>
          <label>담당자 · 연락처<input maxLength={1000} value={editor.contact} onChange={(e) => setEditor({ ...editor, contact: e.target.value })} /></label>
        </div><label>허락 받은 범위와 기록<textarea required={editor.consent === 'granted'} maxLength={3000} rows={3} placeholder="허락 받은 날짜, 원고·사진과 게시 범위, 대화 기록 위치" value={editor.consent_note} onChange={(e) => setEditor({ ...editor, consent_note: e.target.value })} /></label>
        <div className="merchant-actions"><button className={!selected ? 'merchant-primary' : undefined}>{busy ? '저장 중…' : '업체 정보 저장'}</button>{!selected && <button type="button" onClick={() => { play('selection'); setEditor(null); }}>취소</button>}</div></fieldset>
      </form>}
      {selected && <>
        <form className="merchant-period" onSubmit={(e) => e.preventDefault()}><h2>기간별 성과</h2><div className="merchant-fields">
          <label>시작일<input type="date" disabled={busy} value={period.start} max={period.end} onChange={(e) => { if (e.target.value) { play('selection'); setPeriod({ ...period, start: e.target.value }); } }} /></label>
          <label>종료일<input type="date" disabled={busy} value={period.end} min={period.start} max={periodFor(detail?.merchant.timezone).end} onChange={(e) => { if (e.target.value) { play('selection'); setPeriod({ ...period, end: e.target.value }); } }} /></label>
        </div><p>업체 도시 시간 기준 · 최근 90일 · 조회 기록은 업체 연결 이후부터 집계</p></form>
        {!detail ? <p className="merchant-empty" role="status">{error ? '성과를 불러오지 못했습니다.' : '성과를 불러오는 중…'}</p> : <>
          <MerchantOwnerForm key={`${detail.merchant.id}:${detail.merchant.updated_at}`} merchant={detail.merchant} busy={busy} save={(owner, verified, until) => { void run(() => setAdminMerchantOwner(supabase, selected, owner, verified, until).then(() => {}), '업체 소유 확인과 이용 기간을 저장했습니다.'); }} />
          <section className="merchant-section"><h2>소상공인 도구</h2><p className="merchant-hint">회원 프로필과 같은 초안·원가·재고 도구입니다. 관리자 작업에도 2단계 인증을 적용합니다.</p><button type="button" disabled={busy} aria-expanded={toolsOpen} onClick={() => { play('selection'); setToolsOpen(!toolsOpen); }}>{toolsOpen ? '소상공인 도구 닫기' : '소상공인 도구 열기'}</button>
            {toolsOpen && <MerchantWorkspace merchantId={selected} refreshSignal={revision + refreshSignal} />}
          </section>
          <dl className="merchant-metrics">
            <div><dt>연결된 글</dt><dd>{detail.metrics.linked_posts}편</dd><small>기간 내 새 글 {detail.metrics.new_posts}편</small></div>
            <div><dt>누적 표시 조회수</dt><dd>{detail.metrics.displayed_views.toLocaleString('ko-KR')}회</dd><small>현재 값 · 익명 조회·운영 조정 포함</small></div>
            <div><dt>기간 내 최초 열람</dt><dd>{detail.metrics.first_reads.toLocaleString('ko-KR')}회</dd><small>로그인 회원 {detail.metrics.unique_readers}명 · 재방문 제외</small></div>
            <div><dt>기간 내 업체 링크 클릭</dt><dd>{detail.metrics.source_clicks.toLocaleString('ko-KR')}회</dd><small>외부 이동 버튼을 누른 기록</small></div>
            <div><dt>업체 링크를 누른 로그인 회원</dt><dd>{detail.metrics.member_clickers}명</dd><small>관리자·작성자·시드 계정 제외</small></div>
            <div><dt>업체 링크를 누른 익명 세션</dt><dd>{detail.metrics.anonymous_sessions}개</dd><small>실제 인원 수와 다를 수 있음</small></div>
          </dl>
          <section className="merchant-section"><h2>소개한 글 <span>{detail.merchant.post_count}편</span></h2>
            {!detail.posts.length ? <p className="merchant-hint">이 기간에 연결된 글이 없습니다.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>게시글</th><th>누적 표시 조회</th><th>기간 내 업체 링크 클릭</th></tr></thead><tbody>{detail.posts.map((p) => <tr key={p.post_id}><td><a href={buildSharedPostUrl(p.post_id)} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>{p.title}</a>{p.status !== 'published' && <small> · 비공개</small>}</td><td>{p.displayed_views}</td><td>{p.source_clicks}</td></tr>)}</tbody></table></div>}
            {detail.merchant.consent !== 'granted' ? <p className="merchant-hint">게시 허락을 저장하면 글을 연결하거나 대신 작성할 수 있습니다.</p> : <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (postMode === 'link') await linkMerchantPost(supabase, selected, postId, source);
              else await createMerchantPost(supabase, selected, { title, body, tag_slug: tag, original_url: source, kind, request_id: postRequest });
              setPostId(''); setSource(''); setTitle(''); setBody(''); setPostRequest(merchantEventId());
            }, postMode === 'link' ? '글과 업체 계정·웹사이트 주소를 연결했습니다.' : '글링에 업체 안내를 게시하고 연결했습니다.'); }}>
              <fieldset disabled={busy || !editable}><div className="merchant-actions"><button type="button" aria-pressed={postMode === 'link'} onClick={() => { play('selection'); setPostMode('link'); }}>기존 글 연결</button><button type="button" aria-pressed={postMode === 'create'} onClick={() => { play('selection'); setPostMode('create'); }}>새 안내글 작성</button></div>
              {postMode === 'link' ? <label>글 선택<select required value={postId} onChange={(e) => { play('selection'); setPostId(e.target.value); setSource(detail.posts.find((p) => p.post_id === e.target.value)?.original_url ?? ''); }}><option value="">같은 도시의 최근 글을 선택하세요</option>{detail.available_posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label> : <>
                <div className="merchant-fields"><label>게시 분류<select value={kind} onChange={(e) => { play('selection'); setKind(e.target.value as 'story' | 'listing'); }}><option value="story">이야기 · 업체 안내</option><option value="listing">구인구직 · 거래</option></select></label><label>주제<select value={tag} onChange={(e) => { play('selection'); setTag(e.target.value); }}>{TAGS.filter((t) => t.kind === 'post').map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label></div>
                <label>제목<input required value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></label><label>업체가 허락한 원고<textarea required value={body} maxLength={4700} rows={6} onChange={(e) => setBody(e.target.value)} /></label><p className="merchant-hint">등록하면 글링에 바로 게시됩니다. 업체가 허락한 대행 안내라는 문구가 함께 들어갑니다.</p>
              </>}
              <label>업체 계정·웹사이트 주소<input required type="url" placeholder="https://" value={source} maxLength={2048} onChange={(e) => setSource(e.target.value)} /></label>
              <p className="merchant-hint">무료·유료 운영 중인 업체의 글에 ‘업체 계정으로 가기’ 버튼이 표시됩니다.</p>
              <button className={!draft ? 'merchant-primary' : undefined}>{postMode === 'link' ? '글 연결' : '글링에 게시'}</button></fieldset>
            </form>}
          </section>
          <section className="merchant-section"><div className="merchant-heading"><h2>보고서와 운영 제안</h2><button disabled={busy} onClick={beginReport}>새 보고서 작성</button></div>
            {detail.reports.length > 0 && <label>저장한 보고서<select disabled={busy} value={report?.id ?? ''} onChange={(e) => { const saved = detail.reports.find((r) => r.id === e.target.value); if (saved) openReport(saved); }}><option value="">보고서를 선택하세요</option>{detail.reports.map((r) => <option key={r.id} value={r.id}>{r.period_start}~{r.period_end} · {r.title}</option>)}</select></label>}
            {!draft ? <p className="merchant-hint">선택한 기간의 수치를 보고서에 담고, 다음 운영 내용과 금액을 작성할 수 있습니다.</p> : <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const saved = await saveMerchantReport(supabase, draft); setReport(saved); setDirty(false); }, '보고서를 저장했습니다. HTML 또는 PDF로 내보낼 수 있습니다.'); }}>
              <p className="merchant-hint">{draft.period_start}~{draft.period_end} · {report ? '저장 당시 수치 고정 · 설명과 제안 수정 가능' : '처음 저장할 때 서버에서 수치를 확정합니다.'}</p>
              <fieldset disabled={busy}><label>보고서 제목<input required maxLength={160} value={draft.title} onChange={(e) => changeDraft({ title: e.target.value })} /></label>
              <label>운영 결과 설명<textarea rows={4} maxLength={5000} placeholder="소개한 내용과 확인된 반응을 작성하세요." value={draft.summary} onChange={(e) => changeDraft({ summary: e.target.value })} /></label>
              <label>다음 운영 제안<textarea rows={4} maxLength={3000} placeholder="앞으로 소개할 글의 주제·횟수·기간 등 업체에 제안할 내용을 작성하세요." value={draft.next_step} onChange={(e) => changeDraft({ next_step: e.target.value })} /></label>
              <div className="merchant-fields"><label>운영 기간<select value={draft.proposal_period} onChange={(e) => { play('selection'); changeDraft({ proposal_period: e.target.value as 'month' | 'two_weeks' }); }}><option value="two_weeks">2주</option><option value="month">1개월</option></select></label>
                <label>제안 금액 · CAD<input type="number" min="0" max="99999999" step="0.01" placeholder="미입력 시 금액 생략" value={draft.proposal_amount ?? ''} onChange={(e) => changeDraft({ proposal_amount: e.target.value === '' ? null : Number(e.target.value) })} /></label></div>
              <label>세금 · 견적 안내<input maxLength={300} value={draft.tax_note} onChange={(e) => changeDraft({ tax_note: e.target.value })} /></label>
              <button className="merchant-primary">{busy ? '저장 중…' : report ? '보고서 수정 저장' : '보고서 저장'}</button></fieldset>
            </form>}
            {report && <><div className="merchant-actions"><button disabled={busy || dirty} onClick={() => exportReport(false)}>HTML 다운로드</button><button disabled={busy || dirty} onClick={() => exportReport(true)}>PDF로 저장 · 인쇄</button><button disabled={busy || dirty} onClick={() => { play('selection'); void navigator.clipboard.writeText(merchantReportText(report)).then(() => setNotice('보고서 내용을 복사했습니다.')).catch(() => setError('복사하지 못했습니다. HTML 파일을 내려받아 주세요.')); }}>텍스트 복사</button></div>{dirty && <p className="merchant-hint">수정한 내용을 저장한 뒤 내보내세요.</p>}
              <details onToggle={(e) => { if (e.currentTarget.open) play('selection'); }}><summary>저장된 보고서 미리보기</summary><iframe title="업체 전달용 보고서" sandbox="" srcDoc={merchantReportHtml(report, logo)} /></details></>}
          </section>
        </>}
      </>}
    </div></div>
  </section>;
}

function MerchantOwnerForm({ merchant, busy, save }: { merchant: Merchant; busy: boolean; save: (owner: string, verified: boolean, until: string | null) => void }) {
  const { play } = useInteractionFeedback();
  const [owner, setOwner] = useState(merchant.owner_id ?? ''), [verified, setVerified] = useState(!!merchant.owner_verified_at), [until, setUntil] = useState(merchant.workspace_until ?? '');
  return <form className="merchant-section" onSubmit={(e) => { e.preventDefault(); play('selection'); save(owner.trim(), verified, until || null); }}>
    <h2>업체 계정과 이용 기간</h2><fieldset disabled={busy}><label>소유자 회원 ID<input required readOnly={!!merchant.owner_id} pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
      <label className="merchant-owner-check"><input type="checkbox" checked={verified} onChange={(e) => { play('selection'); setVerified(e.target.checked); }} />업체 소유 확인 완료</label><p className="merchant-hint">실제 담당자와 확인한 뒤 표시해 주세요. 회원이 업체를 등록한 것만으로 소유를 인증하지 않습니다.</p>
      <label>업체 유료 운영 종료일<input type="date" value={until} min={periodFor(merchant.timezone).end} onChange={(e) => { play('selection'); setUntil(e.target.value); }} /></label><p className="merchant-hint">유료 운영 상태와 유효한 종료일이 모두 있어야 일괄 도구를 이용합니다. 날짜를 비우면 유료 권한을 해제하며 자동 결제는 실행하지 않습니다.</p>
      <button type="submit">계정 · 이용 기간 저장</button>
    </fieldset>
  </form>;
}
const CITY_ZONE: Record<string, string> = { toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto', calgary: 'America/Edmonton', edmonton: 'America/Edmonton', winnipeg: 'America/Winnipeg', saskatoon: 'America/Regina', regina: 'America/Regina', 'saint-john': 'America/Moncton', halifax: 'America/Halifax' };

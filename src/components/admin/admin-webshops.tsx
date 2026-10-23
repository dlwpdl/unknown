import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import {
  editableWebshopConfig, importAdminWebshopOrders, loadAdminWebshops, parseWebshopConfig, parseWebshopReport,
  saveAdminWebshop, webshopError, webshopMoney,
  type AdminWebshop, type AdminWebshops, type WebshopReport,
} from '@/lib/admin-webshops';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { AdminSelect } from './admin-table-controls';
import './admin-partnerships.css';
import './admin-webshops.css';

const TITLE_STYLE = { ...Typography.screenTitle, lineHeight: `${Typography.screenTitle.lineHeight}px` };
const SECTION_STYLE = { ...Typography.section, lineHeight: `${Typography.section.lineHeight}px` };

type Editor = { kind: 'config' | 'report'; store: AdminWebshop };
const count = (value: number | null | undefined) => value == null ? '확인 불가' : value.toLocaleString('ko-KR');
const date = (value: string | null) => value ? `${new Date(value).toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC` : '미확인';
const STATUS = { completed: '완료', cancelled: '취소', refunded: '전액 환불', partial_refund: '일부 환불' };
const ATTRIBUTION = { provider_report: '공급자 기여 보고', promo_code: '코드 확인', unattributed: '기여 미확인' };

export function AdminWebshopsView({ localPreview, refreshSignal = 0, onStateChange, initialMerchantId = '', onBusinesses }: {
  localPreview: boolean; refreshSignal?: number; initialMerchantId?: string; onBusinesses?: () => void; onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { play } = useInteractionFeedback();
  const [days, setDays] = useState(30), [merchantId, setMerchantId] = useState(initialMerchantId), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminWebshops | null; error: string } | null>(null);
  const [stores, setStores] = useState<AdminWebshop[]>([]);
  const [tab, setTab] = useState<'performance' | 'connections' | 'reports'>('performance');
  const [restaurantConfirmed, setRestaurantConfirmed] = useState(false);
  const editorHeading = useRef<HTMLHeadingElement>(null), editorTrigger = useRef<HTMLButtonElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const requestKey = JSON.stringify([days, merchantId, retry, refreshSignal, localPreview]);
  const current = !localPreview && result?.key === requestKey ? result : null;
  const data = current?.data;
  const loading = !localPreview && !current;

  useEffect(() => {
    let active = true;
    if (localPreview || Platform.OS !== 'web') return;
    void loadAdminWebshops(supabase, days, merchantId || null).then(next => {
      if (!active) return;
      setResult({ key: requestKey, data: next, error: '' });
      const connected = next.stores.filter(store => store.updatedAt && store.url && store.provider === 'uber');
      setStores(previous => merchantId ? [...previous.filter(store => !connected.some(nextStore => nextStore.merchantId === store.merchantId)), ...connected] : connected);
    }).catch(error => { if (active) setResult({ key: requestKey, data: null, error: webshopError(error) }); });
    return () => { active = false; };
  }, [days, merchantId, requestKey, localPreview]);

  useEffect(() => { if (editor) editorHeading.current?.focus(); }, [editor]);
  useEffect(() => { onStateChange?.({ dirty, busy }); }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !busy)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  function closeEditor() {
    if (busy || (dirty && !window.confirm('저장하지 않은 입력을 버릴까요?'))) return;
    play('selection'); setEditor(null); setDirty(false); editorTrigger.current?.focus();
  }
  function openEditor(next: Editor, trigger: HTMLButtonElement) {
    if (busy || (editor?.kind === next.kind && editor.store.merchantId === next.store.merchantId) || (dirty && !window.confirm('저장하지 않은 입력을 버리고 다른 비즈니스를 열까요?'))) return;
    play('selection'); editorTrigger.current = trigger; setEditor(next); setDirty(false); setNotice('');
  }
  function saved(message: string) { setEditor(null); setDirty(false); setNotice(message); setRetry(value => value + 1); }

  const connected = data?.stores.filter(store => store.updatedAt && store.url && store.provider === 'uber') ?? [];
  const candidate = initialMerchantId ? data?.stores.find(store => store.merchantId === initialMerchantId && (!store.updatedAt || !store.url)) : null;
  const reportStore = connected.find(store => store.merchantId === merchantId) ?? (connected.length === 1 ? connected[0] : null);

  if (Platform.OS !== 'web') return <View><ThemedText>웹샵 성과는 기존 비공개 웹 관리자에서 확인해주세요.</ThemedText></View>;
  return <section className="partnership-admin webshop-admin" aria-label="웹샵 성과">
    <header className="webshop-heading"><div><span className="webshop-eyebrow">UBER 웹샵</span><h1 style={TITLE_STYLE}>웹샵 성과</h1><p className="partnership-muted">연결한 음식점의 방문과 확인된 주문을 한눈에 봅니다.</p></div>
      <button type="button" disabled={loading || localPreview || busy || dirty} onClick={() => { play('selection'); setRetry(value => value + 1); }}>새로고침</button>
    </header>
    <fieldset className="webshop-toolbar" disabled={busy || !!editor}><legend className="admin-sr-only">웹샵 성과 필터</legend>
      <AdminSelect label="조회 기간" value={String(days)} options={[7, 30, 90].map(value => ({ value: String(value), label: `최근 ${value}일` }))} onChange={value => { play('selection'); setDays(Number(value)); }} />
      <AdminSelect label="비즈니스" value={merchantId} options={[{ value: '', label: '연결한 음식점 전체' }, ...stores.map(store => ({ value: store.merchantId, label: store.name })), ...(candidate ? [{ value: candidate.merchantId, label: `${candidate.name} · 연결 전` }] : [])]} onChange={value => { play('selection'); setMerchantId(value); }} />
      <span className="webshop-updated">{data ? `갱신 ${date(data.generatedAt)}` : 'UTC 기준'}</span>
    </fieldset>
    {notice && <p role="status" className="webshop-notice">{notice}</p>}
    {localPreview ? <p role="status">실제 운영 데이터는 관리자 로그인과 MFA 인증 후 표시됩니다.</p>
      : loading ? <p role="status" aria-busy="true">웹샵 성과를 불러오는 중입니다.</p>
        : current?.error ? <div role="alert" className="webshop-panel"><p>{current.error} 조회 실패를 0건으로 표시하지 않습니다.</p><button type="button" onClick={() => { play('selection'); setRetry(value => value + 1); }}>다시 시도</button></div>
          : data && <>
            <div className="webshop-metrics" aria-label="핵심 성과">
              {[
                ['비교표 조회', count(data.totals.sheetViews), '메뉴 가격을 확인한 횟수'],
                ['웹샵 방문', count(data.totals.clicks), '주문 페이지로 이동한 횟수'],
                ['확인된 주문', data.totals.verifiedOrders == null ? '보고서 대기' : count(data.totals.verifiedOrders), '실제 주문 보고서 기준'],
                ['확인된 순매출', data.totals.netRevenueCents == null ? '보고서 대기' : webshopMoney(data.totals.netRevenueCents, data.totals.currency), '음식 소계에서 환불 차감'],
              ].map(([label, value, note]) => <article className="webshop-metric" key={label}><h2>{label}</h2><strong className={value === '보고서 대기' ? 'webshop-pending' : undefined}>{value}</strong><p>{note}</p></article>)}
            </div>
            <div className="webshop-tabs" role="tablist" aria-label="웹샵 성과 보기" onKeyDown={event => {
              if (busy || editor) return;
              const tabs = ['performance', 'connections', 'reports'] as const, index = tabs.indexOf(tab);
              const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
              if (next === null) return;
              event.preventDefault(); play('selection'); setTab(tabs[next]);
              event.currentTarget.querySelector<HTMLButtonElement>(`#webshop-tab-${tabs[next]}`)?.focus();
            }}>
              {([['performance', '성과 요약'], ['connections', '연결·가격'], ['reports', '주문 보고서']] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`webshop-tab-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls="webshop-panel" disabled={busy || !!editor} onClick={() => { play('selection'); setTab(value); }}>{label}</button>)}
            </div>
            <div id="webshop-panel" role="tabpanel" aria-labelledby={`webshop-tab-${tab}`}>
              {tab === 'performance' && <div className="webshop-overview">
                <section className="webshop-panel"><div className="webshop-section-title"><div><h2 style={SECTION_STYLE}>연결한 음식점 <span>{connected.length}</span></h2><p className="partnership-muted">Uber 주문이 가능한 음식점만 직접 연결합니다.</p></div>{onBusinesses && <button type="button" disabled={busy || dirty} onClick={() => { play('selection'); onBusinesses(); }}>비즈니스 프로필에서 선택</button>}</div>
                  {connected.length ? connected.map(store => <div className="webshop-restaurant" key={store.merchantId}><span className="webshop-monogram" aria-hidden="true">{store.name.slice(0, 1)}</span><div className="webshop-restaurant-info"><h3>{store.name}</h3><p>{store.cityId} · {store.enabled ? 'Uber 웹샵 연결됨' : '주문 일시 중지'}</p><small>대표 메뉴 {store.comparisons.length}개 · 가격 확인 {date(store.verifiedAt)}</small></div><button type="button" disabled={busy} onClick={event => { setTab('connections'); openEditor({ kind: 'config', store }, event.currentTarget); }}>연결 관리</button></div>) : <p className="partnership-muted">연결한 음식점이 없습니다. 다른 비즈니스가 자동으로 추가되지는 않습니다.</p>}
                </section>
                <section className="webshop-panel webshop-report-status"><span className="webshop-eyebrow">주문 데이터</span><h2 style={SECTION_STYLE}>{data.totals.orderDataAvailable ? '주문 보고서가 연결됐어요' : '주문 보고서를 기다리고 있어요'}</h2><p className="partnership-muted">웹샵 방문은 주문 완료가 아닙니다. 공급자 또는 음식점 보고서를 가져오면 주문과 매출이 표시됩니다.</p><button type="button" className="partnership-primary" disabled={busy || !reportStore} onClick={event => { if (reportStore) openEditor({ kind: 'report', store: reportStore }, event.currentTarget); }}>보고서 가져오기</button>{!reportStore && connected.length > 1 && <small>음식점을 선택한 뒤 가져와주세요.</small>}</section>
                <details className="webshop-panel webshop-wide" onToggle={event => { if (event.isTrusted) play('selection'); }}><summary>일별 방문 기록 <span>비교표 조회 · 웹샵 이동</span></summary><Table caption="일별 웹샵 성과" headers={['날짜 (UTC)', '비교표 조회', '웹샵 방문', '확인된 주문', '순매출 (CAD)']} rows={data.daily.map(row => ({ key: row.day, cells: [row.day, count(row.sheetViews), count(row.clicks), count(row.verifiedOrders), webshopMoney(row.netRevenueCents)] }))} empty="선택 기간의 일별 기록이 없습니다." /></details>
              </div>}
              {tab === 'connections' && <section className="webshop-panel"><div className="webshop-section-title"><div><h2 style={SECTION_STYLE}>웹샵·메뉴 가격</h2><p className="partnership-muted">연결하지 않은 비즈니스는 이 목록에 포함하지 않습니다.</p></div>{onBusinesses && <button type="button" disabled={busy || dirty} onClick={() => { play('selection'); onBusinesses(); }}>프로필에서 선택</button>}</div>
                {connected.map(store => <article className="webshop-connection" key={store.merchantId}><div className="webshop-section-title"><div><h3>{store.name}</h3><p className="partnership-muted">{store.enabled ? '주문 활성' : '주문 일시 중지'} · {store.cityId}</p></div><button type="button" disabled={busy} onClick={event => openEditor({ kind: 'config', store }, event.currentTarget)}>설정</button></div><p className="webshop-url">{store.url}</p><Table caption={`${store.name} 메뉴 가격 비교`} headers={['확인한 대표 메뉴', 'Uber Eats', '웹샵', '메뉴 가격 차이']} rows={store.comparisons.map(menu => ({ key: menu.id, cells: [menu.name, webshopMoney(menu.uberCents), webshopMoney(menu.webCents), webshopMoney(menu.uberCents - menu.webCents)] }))} empty="아직 비교할 메뉴가 없습니다." /><p className="partnership-muted">메뉴 가격만 비교합니다. 배달비·세금·수수료·팁은 포함하지 않습니다.</p><details onToggle={event => { if (event.isTrusted) play('selection'); }}><summary>지점 연결과 수수료 기준</summary><p>장소 연결: {store.placeKeys.join(', ') || '연결 없음'}</p><p>예상 수수료 {store.commissionBps / 100}% · {store.commissionBasisConfirmed ? '음식 순소계 기준 확인' : '정산 기준 미확인'} · {store.commissionScope === 'attributed' ? '기여 확인 주문' : store.commissionScope === 'all_webshop' ? '전체 웹샵 주문' : '적용 범위 미확인'}</p></details></article>)}
                {!connected.length && !candidate && <p className="partnership-muted">연결한 음식점이 없습니다.</p>}
              </section>}
              {candidate && <section className="webshop-panel webshop-candidate"><h2 style={SECTION_STYLE}>선택한 비즈니스 프로필</h2><h3>{candidate.name}</h3><p>아직 웹샵에 연결되지 않았습니다. Uber 주문이 가능한 음식점인지 확인한 뒤 정확한 지점의 웹샵을 등록해주세요.</p><label><input type="checkbox" checked={restaurantConfirmed} onChange={event => { play('selection'); setRestaurantConfirmed(event.target.checked); }} /> 음식점이며 Uber 주문이 가능한 것을 확인했어요.</label><button type="button" disabled={!restaurantConfirmed || busy} onClick={event => openEditor({ kind: 'config', store: candidate }, event.currentTarget)}>이 음식점 웹샵 연결</button></section>}
              {tab === 'reports' && <section className="webshop-panel"><div className="webshop-section-title"><div><h2 style={SECTION_STYLE}>주문 보고서</h2><p className="partnership-muted">글링 기여가 확인된 주문과 전체 보고 주문을 구분합니다.</p></div><button type="button" disabled={busy || !reportStore} onClick={event => { if (reportStore) openEditor({ kind: 'report', store: reportStore }, event.currentTarget); }}>보고서 가져오기</button></div><Table mobileRows caption="검증된 주문 보고서 행" headers={['음식점', '외부 주문 / 보고서 ID', '주문 시각', '통화', '음식 소계', '환불액', '상태 / 기여', '근거']} rows={data.orders.map(row => ({ key: `${row.merchantId}:${row.externalOrderId}`, cells: [stores.find(store => store.merchantId === row.merchantId)?.name ?? row.merchantId, <>{row.externalOrderId}<small>{row.reportId}</small></>, date(row.orderedAt), row.currency, webshopMoney(row.foodSubtotalCents, row.currency), webshopMoney(row.refundCents, row.currency), <>{STATUS[row.status] ?? row.status}<small>{ATTRIBUTION[row.attribution] ?? row.attribution}</small></>, row.evidence] }))} empty="선택 기간에 가져온 주문 보고서가 없습니다. 방문 기록으로 주문을 만들지 않습니다." /><p className="partnership-muted">보고서가 없는 구간은 주문 미확인입니다. 수수료는 예상액이며 지급·정산액이 아닙니다.</p></section>}
            </div>
            <details className="webshop-panel" onToggle={event => { if (event.isTrusted) play('selection'); }}><summary>상세 성과와 집계 기준</summary><Table caption="음식점별 상세 웹샵 성과" headers={['음식점', '비교표 조회', '웹샵 방문 / 세션', '확인 주문 / 기여 확인', '전체 순매출 / 기여 확인', '예상 수수료']} rows={data.breakdown.filter(row => connected.some(store => store.merchantId === row.merchantId)).map(row => ({ key: row.merchantId, cells: [row.name, count(row.sheetViews), `${count(row.clicks)} / ${count(row.sessions)}`, `${count(row.verifiedOrders)} / ${count(row.attributedVerifiedOrders)}`, `${webshopMoney(row.netRevenueCents, row.currency)} / ${webshopMoney(row.attributedNetRevenueCents, row.currency)}`, webshopMoney(row.estimatedCommissionCents, row.currency)] }))} empty="연결한 음식점의 집계가 없습니다." /><p className="partnership-muted">UTC 기준 · 내부 계정 제외 · 음식 소계에서 환불 차감 · 취소 주문 제외 · 보고서가 덮는 구간만 주문 집계 · 주문 미수신은 0건이 아닙니다.</p></details>
          </>}
    {editor && <section className="webshop-panel webshop-editor" aria-label={`${editor.store.name} ${editor.kind === 'config' ? '웹샵 설정' : '보고서 가져오기'}`}>
      <div className="webshop-section-title"><h2 ref={editorHeading} tabIndex={-1} style={SECTION_STYLE}>{editor.store.name} · {editor.kind === 'config' ? '웹샵 설정' : '보고서 가져오기'}</h2><button type="button" disabled={busy} onClick={closeEditor}>닫기</button></div>
      {editor.kind === 'config' ? <ConfigEditor key={`config:${editor.store.merchantId}`} store={editor.store} onDirty={setDirty} onBusy={setBusy} onSaved={() => saved('서버가 저장한 설정과 수정 버전을 확인했습니다.')} />
        : <ReportEditor key={`report:${editor.store.merchantId}`} store={editor.store} onDirty={setDirty} onBusy={setBusy} onSaved={saved} />}
    </section>}
  </section>;
}

function Table({ caption, headers, rows, empty, mobileRows = false }: { mobileRows?: boolean; caption: string; headers: string[]; rows: { key: string; cells: ReactNode[] }[]; empty: string }) {
  return <div className="admin-table-wrap" role="region" aria-label={caption} tabIndex={0}><table role="table" className={`admin-table admin-table-dense partnership-table${mobileRows ? ' admin-webshop-mobile-rows' : ''}`}><caption className="admin-sr-only">{caption}</caption><thead role="rowgroup"><tr role="row">{headers.map(header => <th role="columnheader" scope="col" key={header}>{header}</th>)}</tr></thead><tbody role="rowgroup">{rows.length ? rows.map(row => <tr role="row" key={row.key}>{row.cells.map((cell, index) => <td role="cell" key={index} data-label={headers[index]}>{cell}</td>)}</tr>) : <tr role="row"><td role="cell" colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}

type EditorCallbacks = { store: AdminWebshop; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onSaved: (message: string) => void };
function ConfigEditor({ store, onDirty, onBusy, onSaved }: EditorCallbacks) {
  const { play } = useInteractionFeedback();
  const initial = editableWebshopConfig(store);
  const [config, setConfig] = useState(initial), [placeKeys, setPlaceKeys] = useState(initial.placeKeys.join('\n'));
  const [comparisons, setComparisons] = useState(JSON.stringify(initial.comparisons, null, 2)), [checkout, setCheckout] = useState(JSON.stringify(initial.checkoutComparison, null, 2));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const change = (next: Partial<typeof config>) => { setConfig(value => ({ ...value, ...next })); onDirty(true); };
  async function submit() {
    if (pending.current) return;
    let parsed;
    try { parsed = parseWebshopConfig(JSON.stringify({ ...config, placeKeys: placeKeys.split(/\r?\n/).map(value => value.trim()).filter(Boolean), comparisons: JSON.parse(comparisons), checkoutComparison: JSON.parse(checkout) })); }
    catch (reason) { setError(reason instanceof SyntaxError ? '메뉴·결제 비교 JSON 문법을 확인해주세요.' : reason instanceof Error ? reason.message : '입력 내용을 확인해주세요.'); play('warning'); return; }
    pending.current = true; setBusy(true); onBusy(true); setError(''); play('selection');
    try {
      const saved = await saveAdminWebshop(supabase, store.merchantId, parsed);
      if (!saved.updatedAt || saved.merchantId !== store.merchantId) throw new Error('updatedAt readback missing');
      onSaved('');
    } catch (reason) { setError(webshopError(reason)); play('warning'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="partnership-form" onFocusCapture={() => play('selection')} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p className="partnership-muted">도시 {store.cityId} · 같은 지점인지 확인한 뒤 연결해주세요. 수정 버전은 서버 값으로 유지합니다.</p>
    <fieldset disabled={busy} style={{ display: 'flex', flexDirection: 'column', gap: Spacing.three }}><legend className="admin-sr-only">웹샵 설정 입력</legend><div className="partnership-form-grid">
      <label>Uber 웹샵 URL<input type="url" maxLength={2048} value={config.url ?? ''} placeholder="https://www.order.store/ca/store/지점/ID" onChange={event => change({ url: event.target.value || null })} /></label>
      <label className="partnership-check"><input type="checkbox" checked={config.enabled} onChange={event => { play('selection'); change({ enabled: event.target.checked }); }} />웹샵 주문 활성</label>
      <label>명시적인 같은 지점 장소 키 · 한 줄에 하나<textarea rows={3} maxLength={15000} value={placeKeys} placeholder={'osm:node:12345\npartner:existing-branch-key'} onChange={event => { setPlaceKeys(event.target.value); onDirty(true); }} /></label>
      <label>메뉴 가격 관측 시각 · ISO / UTC<input value={config.verifiedAt ?? ''} maxLength={40} placeholder="2026-10-23T11:02:46Z" onChange={event => change({ verifiedAt: event.target.value || null })} /></label>
    </div>
      <label>메뉴 가격 비교 · CAD 정수 센트<textarea rows={6} maxLength={30000} spellCheck={false} value={comparisons} onChange={event => { setComparisons(event.target.value); onDirty(true); }} /><span className="partnership-muted">배열 형식: {`[{"id":"menu-id","name":"메뉴명","uberCents":2400,"webCents":1900}]`} · 실제 확인한 메뉴만 입력합니다.</span></label>
      <label>확인된 프로모션 코드 · 없으면 비워두기<input maxLength={40} value={config.promoCode ?? ''} onChange={event => change({ promoCode: event.target.value || null })} /></label>
      <details onToggle={() => play('selection')}><summary>전체 결제 견적 · 선택</summary><p className="partnership-muted">현재 최종 요금은 미확인입니다. 양쪽의 모든 금액을 같은 조건에서 직접 관측했을 때만 입력하세요. 정보가 없으면 null을 유지합니다. 주소는 저장하지 않습니다.</p>
        <p className="partnership-muted">필드: verifiedAt, fulfillment (delivery/pickup), basketLabel, sameConditionsConfirmed:true, uber, webshop. 각 견적: itemsCents, deliveryCents, serviceCents, discountCents, taxCents, tipCents, totalCents. 모든 금액은 필수이며 0도 관측값이어야 합니다.</p>
        <label>전체 결제 비교 JSON<textarea rows={8} maxLength={12000} spellCheck={false} value={checkout} onChange={event => { setCheckout(event.target.value); onDirty(true); }} /></label>
      </details>
      <div className="partnership-form-grid"><label>수수료율 (%)<input type="number" min="0" max="100" step="0.01" value={config.commissionBps / 100} onChange={event => change({ commissionBps: Math.round(Number(event.target.value) * 100) })} /></label>
        <label>합의된 수수료 적용 범위<select value={config.commissionScope ?? ''} onChange={event => { play('selection'); change({ commissionScope: (event.target.value || null) as typeof config.commissionScope }); }}><option value="">미확인 · 예상액 표시 안 함</option><option value="attributed">기여 확인 주문만</option><option value="all_webshop">전체 웹샵 보고 주문</option></select></label></div>
      <label className="partnership-check"><input type="checkbox" checked={config.commissionBasisConfirmed} onChange={event => { play('selection'); change({ commissionBasisConfirmed: event.target.checked }); }} />음식 소계에서 환불 차감·취소 제외·배달/서비스/세금/팁 제외 기준이 실제 합의된 것을 확인했습니다.</label>
      <p className="partnership-muted">25% 수수료율과 별개로 기준·적용 범위를 모두 확인해야 예상 수수료를 계산합니다. 미확인 조건을 추정하지 마세요.</p>
    </fieldset>
    {error && <p role="alert" className="partnership-form-error">{error}</p>}
    <div className="partnership-form-actions" style={{ position: 'static' }}><button type="submit" className="partnership-primary" disabled={busy} aria-busy={busy}>{busy ? '저장 중…' : '설정 저장'}</button></div>
  </form>;
}

function ReportEditor({ store, onDirty, onBusy, onSaved }: EditorCallbacks) {
  const { play } = useInteractionFeedback();
  const [value, setValue] = useState(() => JSON.stringify({ reportId: globalThis.crypto.randomUUID(), periodStart: '', periodEnd: '', evidence: '', orders: [] }, null, 2));
  const [preview, setPreview] = useState<WebshopReport | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  function validate() {
    play('selection'); setPreview(null); setConfirmed(false);
    try { setPreview(parseWebshopReport(value)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '보고서 내용을 확인해주세요.'); play('warning'); }
  }
  async function submit() {
    if (!preview || !confirmed || pending.current) return;
    pending.current = true; setBusy(true); onBusy(true); setError(''); play('selection');
    try {
      const result = await importAdminWebshopOrders(supabase, store.merchantId, preview);
      onSaved(`보고서를 확인했습니다. 가져온 주문 ${result.imported}건 · 동일한 기존 주문 ${result.duplicates}건.`);
    } catch (reason) { setError(webshopError(reason)); play('warning'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="partnership-form" onFocusCapture={() => play('selection')} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p className="partnership-muted">공급자·비즈니스의 실제 보고서만 입력하세요. 고객 이름·주소·카드·이메일은 포함하지 않습니다. 기존 외부 주문 ID의 다른 금액은 충돌로 거절하며, 동일 보고서 재시도는 같은 reportId를 유지합니다.</p>
    <details onToggle={() => play('selection')}><summary>JSON 보고서 형식과 검증 기준</summary><p className="partnership-muted">reportId: UUID, periodStart/periodEnd: 시간대가 있는 ISO 날짜(종료 미포함), evidence: 보고서 출처·문서 번호 등 근거, orders: 실제 주문 배열(최대 5000건). 0건은 보고서에서 무주문이 실제 확인된 경우에만 허용합니다. 금액은 CAD 정수 센트입니다.</p>
      <p className="partnership-muted">주문 필드: externalOrderId, orderedAt, currency:CAD, foodSubtotalCents, refundCents, status, attribution. status는 completed/cancelled/refunded/partial_refund, attribution은 provider_report/promo_code/unattributed입니다. provider_report는 글링 기여가 확인된 경우에만 사용합니다. 확인할 수 없으면 unattributed를 사용하세요.</p>
      <p className="partnership-muted">완료 주문의 환불은 0, 전액 환불은 소계와 같은 금액, 일부 환불은 0 초과·소계 미만입니다. 취소 주문은 매출에서 제외합니다. 지원하지 않는 통화와 불명확한 금액은 가져오지 않습니다.</p>
    </details>
    <fieldset disabled={busy} style={{ display: 'flex', flexDirection: 'column', gap: Spacing.three }}><legend className="admin-sr-only">주문 보고서 입력</legend><label>근거가 포함된 주문 보고서 JSON<textarea rows={14} maxLength={2000000} spellCheck={false} value={value} onChange={event => { setValue(event.target.value); setPreview(null); setConfirmed(false); onDirty(true); }} /></label>
      <button type="button" onClick={validate}>보고서 검증</button>
      {preview && <div className="admin-summary-strip"><span>실제 주문<strong>{preview.orders.length}건</strong></span><span>기간<strong>{date(preview.periodStart)}–{date(preview.periodEnd)}</strong></span><span>취소 / 환불<strong>{preview.orders.filter(row => row.status === 'cancelled').length} / {preview.orders.filter(row => row.refundCents > 0).length}건</strong></span><span>기여 미확인<strong>{preview.orders.filter(row => row.attribution === 'unattributed').length}건</strong></span></div>}
      {preview && <label className="partnership-check"><input type="checkbox" checked={confirmed} onChange={event => { play('selection'); setConfirmed(event.target.checked); onDirty(true); }} />{store.name}의 실제 보고서·기간·기여 근거{preview.orders.length === 0 ? '와 실제 주문 0건' : ''}을 확인했고 고객 정보가 포함되지 않았습니다.</label>}
    </fieldset>
    {error && <p role="alert" className="partnership-form-error">{error}</p>}
    <div className="partnership-form-actions" style={{ position: 'static' }}><button type="submit" className="partnership-primary" disabled={busy || !preview || !confirmed} aria-busy={busy}>{busy ? '가져오는 중…' : '검증한 보고서 가져오기'}</button></div>
  </form>;
}

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
import { adminOptionKeys } from '@/lib/admin';
import { AdminSelect } from './admin-table-controls';
import { AdminInfo, AdminPill } from './admin-ui';
import './admin-partnerships.css';
import './admin-partner-workspace.css';

const TITLE_STYLE = { ...Typography.screenTitle, lineHeight: `${Typography.screenTitle.lineHeight}px` };
const SECTION_STYLE = { ...Typography.section, lineHeight: `${Typography.section.lineHeight}px` };

type Editor = { kind: 'config'; store: AdminWebshop } | { kind: 'report'; store: AdminWebshop | null };
const count = (value: number | null | undefined) => value == null ? '확인 불가' : value.toLocaleString('ko-KR');
const date = (value: string | null) => value ? `${new Date(value).toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC` : '미확인';
const STATUS = { completed: '완료', cancelled: '취소', refunded: '전액 환불', partial_refund: '일부 환불' };
const ATTRIBUTION = { provider_report: '공급자 기여 보고', promo_code: '코드 확인', unattributed: '기여 미확인' };

export function AdminWebshopsView({ localPreview, refreshSignal = 0, onStateChange, initialMerchantId = '' }: {
  localPreview: boolean; refreshSignal?: number; initialMerchantId?: string; onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { play } = useInteractionFeedback();
  const [days, setDays] = useState(30), [merchantId, setMerchantId] = useState(initialMerchantId), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminWebshops | null; error: string } | null>(null);
  const [stores, setStores] = useState<AdminWebshop[]>([]);
  const editorHeading = useRef<HTMLHeadingElement>(null), editorTrigger = useRef<HTMLButtonElement | null>(null), dialog = useRef<HTMLDialogElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'stores' | 'orders'>('stores');
  const requestKey = JSON.stringify([days, merchantId, retry, refreshSignal, localPreview]);
  const current = !localPreview && result?.key === requestKey ? result : null;
  const data = current?.data;
  const loading = !localPreview && !current;
  // A report belongs to one saved webshop; open it directly when the filter or data leaves only one choice.
  const importable = data?.stores.filter(store => store.updatedAt) ?? [];
  const importTarget = importable.find(store => store.merchantId === merchantId) ?? (importable.length === 1 ? importable[0] : null);

  useEffect(() => {
    let active = true;
    if (localPreview || Platform.OS !== 'web') return;
    void loadAdminWebshops(supabase, days, merchantId || null).then(next => {
      if (!active) return;
      setResult({ key: requestKey, data: next, error: '' });
      setStores(previous => merchantId ? [...previous.filter(store => !next.stores.some(nextStore => nextStore.merchantId === store.merchantId)), ...next.stores] : next.stores);
    }).catch(error => { if (active) setResult({ key: requestKey, data: null, error: webshopError(error) }); });
    return () => { active = false; };
  }, [days, merchantId, requestKey, localPreview]);

  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
    if (!editor && dialog.current?.open) dialog.current.close();
    if (editor) editorHeading.current?.focus();
  }, [editor]);
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
    if (busy || (editor?.kind === next.kind && editor.store?.merchantId === next.store?.merchantId) || (dirty && !window.confirm('저장하지 않은 입력을 버리고 다른 비즈니스를 열까요?'))) return;
    play('selection'); editorTrigger.current = trigger; setEditor(next); setDirty(false); setNotice('');
  }
  function saved(message: string) { setEditor(null); setDirty(false); setNotice(message); setRetry(value => value + 1); }
  const editorTitle = editor ? `${editor.store ? `${editor.store.name} · ` : ''}${editor.kind === 'config' ? '연결 관리' : '보고서 가져오기'}` : '';

  if (Platform.OS !== 'web') return <View><ThemedText>웹샵 성과는 기존 비공개 웹 관리자에서 확인해주세요.</ThemedText></View>;
  return <section className="partnership-admin partner-workspace" aria-label="웹샵 성과" style={{ display: 'flex', flexDirection: 'column', gap: Spacing.four, minWidth: 0 }}>
    <header className="partnership-heading" style={{ marginBottom: 0 }}><div className="partnership-title-row"><h1 style={TITLE_STYLE}>웹샵 성과</h1><AdminInfo label="웹샵 성과 기준" text={[
      '비교표 조회와 웹샵 이동, 확인된 주문을 나눠서 보여줘요.',
      '클릭이나 브라우저 닫기는 주문이 아니에요. 주문·매출은 공급자나 비즈니스 보고서로만 확인하고, 받지 못한 보고서는 0건으로 표시하지 않아요.',
      'UTC 기준이고 내부 계정은 빠져요. 보고서가 덮는 구간만 주문으로 집계해요.',
      '순매출은 음식 소계에서 환불을 빼고 취소 주문을 제외한 금액이에요. 수수료는 예상액이며 지급·정산액이 아니에요.',
      ...(data ? [`갱신 ${date(data.generatedAt)}`] : []),
    ]} /></div>
      <button type="button" className="partnership-primary" disabled={!data || busy || !importable.length} title={data && !importable.length ? '웹샵 설정을 먼저 저장해 주세요.' : undefined} onClick={event => openEditor({ kind: 'report', store: importTarget }, event.currentTarget)}>보고서 가져오기</button>
    </header>
    <fieldset className="admin-toolbar" disabled={busy || !!editor} style={{ margin: 0 }}><legend className="admin-sr-only">웹샵 성과 필터</legend>
      <AdminSelect label="조회 기간" value={String(days)} options={[7, 30, 90].map(value => ({ value: String(value), label: `최근 ${value}일` }))} onChange={value => setDays(Number(value))} />
      <AdminSelect label="비즈니스" value={merchantId} options={[{ value: '', label: '전체 비즈니스' }, ...stores.map(store => ({ value: store.merchantId, label: `${store.name} · ${store.cityId}` }))]} onChange={setMerchantId} />
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {localPreview ? <p role="status">실제 운영 데이터는 관리자 로그인과 MFA 인증 후 표시됩니다.</p>
      : loading ? <p role="status" aria-busy="true">웹샵 성과를 불러오는 중입니다.</p>
        : current?.error ? <div role="alert"><p>{current.error} 조회 실패를 0건으로 표시하지 않습니다.</p><button type="button" onClick={() => { play('selection'); setRetry(value => value + 1); }}>다시 시도</button></div>
          : data && <>
            <div className="admin-summary-strip">
              {[['비교표 조회', count(data.totals.sheetViews)], ['웹샵 이동', count(data.totals.clicks)], ['확인된 주문', count(data.totals.verifiedOrders)], ['순매출', webshopMoney(data.totals.netRevenueCents, data.totals.currency)]].map(([label, value]) => <span key={label}>{label}<strong>{value}</strong></span>)}
            </div>
            {!data.totals.orderDataAvailable && <p className="partnership-muted">선택 기간에 검증된 주문 보고서가 없어서 주문·매출·예상 수수료는 확인할 수 없어요.</p>}
            <div role="tablist" aria-label="웹샵 성과 보기" className="webshop-tabs">
              {([['stores', '음식점', data.stores.length], ['orders', '주문 보고서', null]] as const).map(([value, label, total]) => <button key={value} type="button" role="tab" id={`webshop-tab-${value}`} aria-selected={tab === value} aria-controls={`webshop-panel-${value}`} tabIndex={tab === value ? 0 : -1}
                onKeyDown={adminOptionKeys} onClick={() => { play('selection'); setTab(value); }}>{label}{total != null && <span className="webshop-tab-count">{total}</span>}</button>)}
            </div>
            {tab === 'stores' ? <div role="tabpanel" id="webshop-panel-stores" aria-labelledby="webshop-tab-stores" className="webshop-panel">
              {!data.stores.length ? <p className="partnership-muted">기존 비즈니스를 등록한 뒤 웹샵과 연결할 수 있어요.</p> : <ul className="webshop-stores" aria-label="웹샵과 지점 설정">{data.stores.map(store => {
                const status = !store.url ? { label: '웹샵 미등록', tone: 'neutral' as const } : !store.enabled ? { label: '주문 비활성', tone: 'neutral' as const } : !store.verifiedAt ? { label: '가격 확인 필요', tone: 'warning' as const } : { label: '연결됨', tone: 'success' as const };
                return <li key={store.merchantId} className="webshop-store">
                  <div className="webshop-store-main"><strong>{store.name}</strong>
                    <small>{[store.cityId, `메뉴 ${store.comparisons.length}개`, store.verifiedAt ? `가격 확인 ${date(store.verifiedAt)}` : null, store.checkoutComparison ? '전체 결제 견적 확인' : '메뉴 소계만 비교'].filter(Boolean).join(' · ')}</small>
                    <small>{[`수수료 ${store.commissionBps / 100}%`, store.commissionScope === 'attributed' ? '기여 확인 주문' : store.commissionScope === 'all_webshop' ? '전체 웹샵 주문' : '적용 범위 미확인', store.commissionBasisConfirmed ? '음식 순소계 기준 확인' : '정산 기준 미확인', store.placeKeys.length ? `장소 키 ${store.placeKeys.length}개` : '장소 연결 없음'].join(' · ')}</small>
                  </div>
                  <AdminPill label={status.label} tone={status.tone} />
                  <button type="button" disabled={busy} aria-label={`${store.name} 연결 관리`} onClick={event => openEditor({ kind: 'config', store }, event.currentTarget)}>연결 관리</button>
                </li>;
              })}</ul>}
              <h2 style={SECTION_STYLE}>음식점별 성과</h2>
              <Table caption="비즈니스별 웹샵 성과" headers={['비즈니스', '비교표 조회', '이동 / 세션', '확인 주문 / 기여 확인', '전체 순매출 / 기여 확인', '예상 수수료']} rows={data.breakdown.map(row => ({ key: row.merchantId, cells: [row.name, count(row.sheetViews), `${count(row.clicks)} / ${count(row.sessions)}`, `${count(row.verifiedOrders)} / ${count(row.attributedVerifiedOrders)}`, `${webshopMoney(row.netRevenueCents, row.currency)} / ${webshopMoney(row.attributedNetRevenueCents, row.currency)}`, webshopMoney(row.estimatedCommissionCents, row.currency)] }))} empty="등록된 비즈니스가 없습니다." />
            </div> : <div role="tabpanel" id="webshop-panel-orders" aria-labelledby="webshop-tab-orders" className="webshop-panel">
              <div className="admin-summary-strip">
                {[['이동 세션', count(data.totals.sessions)], ['기여 확인 주문', count(data.totals.attributedVerifiedOrders)], ['기여 확인 순매출', webshopMoney(data.totals.attributedNetRevenueCents, data.totals.currency)], ['예상 수수료', webshopMoney(data.totals.estimatedCommissionCents, data.totals.currency)]].map(([label, value]) => <span key={label}>{label}<strong>{value}</strong></span>)}
              </div>
              <div className="partnership-title-row"><h2 style={SECTION_STYLE}>확인된 주문</h2><AdminInfo label="확인된 주문 기준" text="기여가 확인되지 않은 매출은 글링 전환으로 계산하지 않아요. 금액은 CAD 정수 센트 원본 기준이에요." /></div>
              <Table mobileRows caption="검증된 주문 보고서 행" headers={['비즈니스', '외부 주문 / 보고서 ID', '주문 시각', '통화', '음식 소계', '환불액', '상태 / 기여', '근거']} rows={data.orders.map(row => ({ key: `${row.merchantId}:${row.externalOrderId}`, cells: [stores.find(store => store.merchantId === row.merchantId)?.name ?? row.merchantId, <>{row.externalOrderId}<small>{row.reportId}</small></>, date(row.orderedAt), row.currency, webshopMoney(row.foodSubtotalCents, row.currency), webshopMoney(row.refundCents, row.currency), <>{STATUS[row.status] ?? row.status}<small>{ATTRIBUTION[row.attribution] ?? row.attribution}</small></>, row.evidence] }))} empty="선택 기간에 가져온 실제 주문이 없습니다. 클릭 기록으로 주문을 만들지 않습니다." />
              <h2 style={SECTION_STYLE}>일별 성과</h2>
              <Table caption="일별 웹샵 성과" headers={['날짜 (UTC)', '비교표 조회', '웹샵 이동', '확인된 주문', '순매출 (CAD)']} rows={data.daily.map(row => ({ key: row.day, cells: [row.day, count(row.sheetViews), count(row.clicks), count(row.verifiedOrders), webshopMoney(row.netRevenueCents)] }))} empty="선택 기간의 일별 기록이 없습니다." />
            </div>}
          </>}
    <dialog ref={dialog} className="partnership-dialog" aria-labelledby="webshop-editor-title" onCancel={event => { event.preventDefault(); closeEditor(); }}>
      {editor && <><header className="partnership-dialog-heading"><h2 id="webshop-editor-title" ref={editorHeading} tabIndex={-1} style={SECTION_STYLE}>{editorTitle}</h2><button type="button" disabled={busy} onClick={closeEditor}>닫기</button></header>
        <div className="partnership-dialog-body">
          {editor.kind === 'config' ? <ConfigEditor key={`config:${editor.store.merchantId}`} store={editor.store} onDirty={setDirty} onBusy={setBusy} onSaved={() => saved('서버가 저장한 설정과 수정 버전을 확인했습니다.')} />
            : editor.store ? <ReportEditor key={`report:${editor.store.merchantId}`} store={editor.store} onDirty={setDirty} onBusy={setBusy} onSaved={saved} />
              : <div className="partnership-form"><AdminSelect label="가져올 음식점" value="" options={[{ value: '', label: '음식점을 골라 주세요' }, ...importable.map(store => ({ value: store.merchantId, label: `${store.name} · ${store.cityId}` }))]} onChange={value => setEditor({ kind: 'report', store: importable.find(store => store.merchantId === value) ?? null })} /></div>}
        </div></>}
    </dialog>
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
  const [menus, setMenus] = useState(() => initial.comparisons.map(row => ({ id: row.id, name: row.name, uberCents: String(row.uberCents), webCents: String(row.webCents) })));
  const [checkout, setCheckout] = useState(JSON.stringify(initial.checkoutComparison, null, 2));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const change = (next: Partial<typeof config>) => { setConfig(value => ({ ...value, ...next })); onDirty(true); };
  const changeMenu = (index: number, next: Partial<(typeof menus)[number]>) => { setMenus(rows => rows.map((row, i) => i === index ? { ...row, ...next } : row)); onDirty(true); };
  // Blank prices become NaN so validation rejects them instead of saving a silent 0.
  const cents = (value: string) => value.trim() === '' ? NaN : Number(value);
  async function submit() {
    if (pending.current) return;
    let parsed;
    try { parsed = parseWebshopConfig(JSON.stringify({ ...config, placeKeys: placeKeys.split(/\r?\n/).map(value => value.trim()).filter(Boolean), comparisons: menus.map(row => ({ id: row.id.trim(), name: row.name.trim(), uberCents: cents(row.uberCents), webCents: cents(row.webCents) })), checkoutComparison: JSON.parse(checkout) })); }
    catch (reason) { setError(reason instanceof SyntaxError ? '전체 결제 견적 JSON 문법을 확인해 주세요.' : reason instanceof Error ? reason.message : '입력 내용을 확인해주세요.'); play('warning'); return; }
    pending.current = true; setBusy(true); onBusy(true); setError(''); play('selection');
    try {
      const saved = await saveAdminWebshop(supabase, store.merchantId, parsed);
      if (!saved.updatedAt || saved.merchantId !== store.merchantId) throw new Error('updatedAt readback missing');
      onSaved('');
    } catch (reason) { setError(webshopError(reason)); play('warning'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="partnership-form" onFocusCapture={() => play('selection')} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="partnership-title-row"><span className="partnership-muted">{store.cityId}</span><AdminInfo label="연결 기준" text={['같은 지점인지 확인한 뒤 연결해 주세요.', '수정 버전은 서버에 저장된 값을 그대로 써요.']} /></div>
    <fieldset disabled={busy} style={{ display: 'flex', flexDirection: 'column', gap: Spacing.three }}><legend className="admin-sr-only">웹샵 설정 입력</legend><div className="partnership-form-grid">
      <label>Uber 웹샵 URL<input type="url" maxLength={2048} value={config.url ?? ''} placeholder="https://www.order.store/ca/store/지점/ID" onChange={event => change({ url: event.target.value || null })} /></label>
      <label className="partnership-check"><input type="checkbox" checked={config.enabled} onChange={event => { play('selection'); change({ enabled: event.target.checked }); }} />웹샵 주문 활성</label>
      <label>명시적인 같은 지점 장소 키 · 한 줄에 하나<textarea rows={3} maxLength={15000} value={placeKeys} placeholder={'osm:node:12345\npartner:existing-branch-key'} onChange={event => { setPlaceKeys(event.target.value); onDirty(true); }} /></label>
      <label>메뉴 가격 관측 시각 · ISO / UTC<input value={config.verifiedAt ?? ''} maxLength={40} placeholder="2026-10-23T11:02:46Z" onChange={event => change({ verifiedAt: event.target.value || null })} /></label>
    </div>
      <fieldset className="partnership-form-group"><legend>메뉴 가격 비교<AdminInfo label="메뉴 가격 기준" text={['실제로 확인한 메뉴만 넣어요.', '금액은 CAD 센트 정수예요. 19.00달러면 1900이에요.']} /></legend>
        {menus.map((menu, index) => <div className="partnership-form-grid" key={index}>
          <label>메뉴명<input maxLength={120} value={menu.name} onChange={event => changeMenu(index, { name: event.target.value })} /></label>
          <label>메뉴 ID<input maxLength={64} spellCheck={false} value={menu.id} placeholder="menu-id" onChange={event => changeMenu(index, { id: event.target.value })} /></label>
          <label>Uber 가격 · 센트<input type="number" inputMode="numeric" min="1" step="1" value={menu.uberCents} onChange={event => changeMenu(index, { uberCents: event.target.value })} /></label>
          <label>웹샵 가격 · 센트<input type="number" inputMode="numeric" min="0" step="1" value={menu.webCents} onChange={event => changeMenu(index, { webCents: event.target.value })} /></label>
          <button type="button" aria-label={`${menu.name || `${index + 1}번 메뉴`} 삭제`} onClick={() => { play('selection'); setMenus(rows => rows.filter((_, i) => i !== index)); onDirty(true); }}>메뉴 삭제</button>
        </div>)}
        <button type="button" disabled={menus.length >= 30} onClick={() => { play('selection'); setMenus(rows => [...rows, { id: `menu-${Date.now().toString(36)}`, name: '', uberCents: '', webCents: '' }]); onDirty(true); }}>메뉴 추가</button>
      </fieldset>
      <label>확인된 프로모션 코드 · 없으면 비워두기<input maxLength={40} value={config.promoCode ?? ''} onChange={event => change({ promoCode: event.target.value || null })} /></label>
      <details onToggle={() => play('selection')}><summary>고급 · 전체 결제 견적 JSON</summary><p className="partnership-muted">현재 최종 요금은 미확인입니다. 양쪽의 모든 금액을 같은 조건에서 직접 관측했을 때만 입력하세요. 정보가 없으면 null을 유지합니다. 주소는 저장하지 않습니다.</p>
        <p className="partnership-muted">필드: verifiedAt, fulfillment (delivery/pickup), basketLabel, sameConditionsConfirmed:true, uber, webshop. 각 견적: itemsCents, deliveryCents, serviceCents, discountCents, taxCents, tipCents, totalCents. 모든 금액은 필수이며 0도 관측값이어야 합니다.</p>
        <label>전체 결제 비교 JSON<textarea rows={8} maxLength={12000} spellCheck={false} value={checkout} onChange={event => { setCheckout(event.target.value); onDirty(true); }} /></label>
      </details>
      <div className="partnership-form-grid"><label>수수료율 (%)<input type="number" min="0" max="100" step="0.01" value={config.commissionBps / 100} onChange={event => change({ commissionBps: Math.round(Number(event.target.value) * 100) })} /></label>
        <label>합의된 수수료 적용 범위<select value={config.commissionScope ?? ''} onChange={event => { play('selection'); change({ commissionScope: (event.target.value || null) as typeof config.commissionScope }); }}><option value="">미확인 · 예상액 표시 안 함</option><option value="attributed">기여 확인 주문만</option><option value="all_webshop">전체 웹샵 보고 주문</option></select></label></div>
      <div className="partnership-title-row"><label className="partnership-check"><input type="checkbox" checked={config.commissionBasisConfirmed} onChange={event => { play('selection'); change({ commissionBasisConfirmed: event.target.checked }); }} />음식 소계에서 환불 차감·취소 제외·배달/서비스/세금/팁 제외 기준이 실제 합의된 것을 확인했습니다.</label>
        <AdminInfo label="예상 수수료 기준" text="수수료율과 별개로 기준과 적용 범위를 모두 확인해야 예상 수수료를 계산해요. 확인하지 않은 조건은 추정하지 마세요." /></div>
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
    <details onToggle={() => play('selection')}><summary>JSON 보고서 형식과 검증 기준</summary><p className="partnership-muted">공급자·비즈니스의 실제 보고서만 넣어요. 고객 이름·주소·카드·이메일은 넣지 않아요. 같은 외부 주문 ID에 다른 금액이 오면 충돌로 거절하고, 같은 보고서를 다시 보내도 reportId는 그대로예요.</p><p className="partnership-muted">reportId: UUID, periodStart/periodEnd: 시간대가 있는 ISO 날짜(종료 미포함), evidence: 보고서 출처·문서 번호 등 근거, orders: 실제 주문 배열(최대 5000건). 0건은 보고서에서 무주문이 실제 확인된 경우에만 허용합니다. 금액은 CAD 정수 센트입니다.</p>
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

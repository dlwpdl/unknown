import { useId, useRef, useState, type ReactNode } from 'react';

import { useInteractionFeedback } from '@/lib/interaction-feedback';

export type AdminFilterOption = { value: string; label: string };

export function AdminMultiFilter({ label, options, value, onChange }: {
  label: string; options: readonly AdminFilterOption[]; value: readonly string[]; onChange: (next: string[]) => void;
}) {
  const { play } = useInteractionFeedback();
  const id = useId();
  const selected = options.filter((option) => value.includes(option.value));
  return <details className="admin-multifilter" name="admin-filters" onToggle={() => play('selection')} onKeyDown={(event) => {
    if (event.key === 'Escape' && event.currentTarget.open) { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary className={value.length ? 'admin-filter-active' : ''} aria-label={`${label} 필터, ${selected.length ? selected.map((option) => option.label).join(', ') : '전체'}`}>
      {label}<span>{selected.length === 1 ? selected[0].label : selected.length ? `${selected.length}개 선택` : '전체'}</span>
    </summary>
    <div className="admin-filter-menu">
      <div className="admin-filter-menu-heading"><strong>{label}</strong><button type="button" disabled={!value.length} onClick={() => { play('selection'); onChange([]); }}>전체</button></div>
      <fieldset><legend className="admin-sr-only">{label} 복수 선택</legend>
        {options.map((option) => <label key={option.value} htmlFor={`${id}-${option.value}`}>
          <input id={`${id}-${option.value}`} type="checkbox" checked={value.includes(option.value)} onChange={(event) => { play('selection'); onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value)); }} />
          {option.label}
        </label>)}
      </fieldset>
      {!options.length && <p className="admin-muted">선택할 항목이 없습니다.</p>}
    </div>
  </details>;
}

export function AdminSelect({ label, options, value, onChange }: {
  label: string; options: readonly AdminFilterOption[]; value: string; onChange: (next: string) => void;
}) {
  const { play } = useInteractionFeedback();
  return <label className="admin-select"><span>{label}</span><select aria-label={label} value={value} onChange={(event) => { play('selection'); onChange(event.target.value); }}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

export function AdminSearch({ value, onChange, onSubmit, placeholder = '검색어 입력' }: {
  value: string; onChange: (value: string) => void; onSubmit?: () => void; placeholder?: string;
}) {
  const { play } = useInteractionFeedback();
  return <form className="admin-search" role="search" onSubmit={(event) => { event.preventDefault(); play('selection'); onSubmit?.(); }}>
    <svg className="admin-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
    <input type="search" value={value} onFocus={() => play('selection')} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={200} />
    {onSubmit && <button type="submit">검색</button>}
  </form>;
}

export function AdminFilterReset({ onReset, disabled = false }: { onReset: () => void; disabled?: boolean }) {
  const { play } = useInteractionFeedback();
  return <button type="button" className="admin-reset" onClick={() => { play('selection'); onReset(); }} disabled={disabled}>초기화</button>;
}

export function AdminTableSummary({ shown, total, loaded, unit = '건' }: { shown: number; total?: number; loaded?: number; unit?: string }) {
  return <div className="admin-table-summary" role="status">{loaded !== undefined ? `불러온 ${loaded.toLocaleString()}${unit} 중 ${shown.toLocaleString()}${unit}`
    : `검색 결과 ${(total ?? shown).toLocaleString()}${unit} · ${shown.toLocaleString()}${unit} 표시`}</div>;
}

// 모든 폭에서 목록을 먼저 보여주고 상세 조건은 필요할 때 펼친다.
export function AdminFilterBar({ applied, children }: { applied: number; children: ReactNode }) {
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => { play('selection'); setOpen(false); toggle.current?.focus(); };
  return (
    <div className="admin-filter-shell" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
      <button ref={toggle} type="button" className="admin-filter-toggle" aria-expanded={open} aria-controls={id} onClick={() => { play('selection'); setOpen((value) => !value); }}>
        필터{applied > 0 ? ` · ${applied}개 적용` : ' · 전체'}
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && <div id={id} className="admin-filter-panel" role="region" aria-label="상세 필터">{children}<button type="button" className="admin-reset admin-filter-done" onClick={close}>필터 닫기</button></div>}
    </div>
  );
}

import { useId, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { isCompactAdminWidth } from '@/lib/admin-layout';

export type AdminFilterOption = { value: string; label: string };

export function AdminMultiFilter({ label, options, value, onChange }: {
  label: string; options: readonly AdminFilterOption[]; value: readonly string[]; onChange: (next: string[]) => void;
}) {
  const id = useId();
  const selected = options.filter((option) => value.includes(option.value));
  return <details className="admin-multifilter" name="admin-filters" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary className={value.length ? 'admin-filter-active' : ''} aria-label={`${label} 필터, ${selected.length ? selected.map((option) => option.label).join(', ') : '전체'}`}>
      {label}<span>{selected.length === 1 ? selected[0].label : selected.length ? `${selected.length}개 선택` : '전체'}</span>
    </summary>
    <div className="admin-filter-menu">
      <div className="admin-filter-menu-heading"><strong>{label}</strong><button type="button" disabled={!value.length} onClick={() => onChange([])}>전체</button></div>
      <fieldset><legend className="admin-sr-only">{label} 복수 선택</legend>
        {options.map((option) => <label key={option.value} htmlFor={`${id}-${option.value}`}>
          <input id={`${id}-${option.value}`} type="checkbox" checked={value.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value))} />
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
  return <label className="admin-select"><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

export function AdminSearch({ value, onChange, onSubmit, placeholder = '검색어 입력' }: {
  value: string; onChange: (value: string) => void; onSubmit?: () => void; placeholder?: string;
}) {
  return <form className="admin-search" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
    <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={200} />
    {onSubmit && <button type="submit">검색</button>}
  </form>;
}

export function AdminFilterReset({ onReset, disabled = false }: { onReset: () => void; disabled?: boolean }) {
  return <button type="button" className="admin-reset" onClick={onReset} disabled={disabled}>초기화</button>;
}

export function AdminTableSummary({ shown, total, loaded, unit = '건' }: { shown: number; total?: number; loaded?: number; unit?: string }) {
  return <div className="admin-table-summary" role="status">{loaded !== undefined ? `불러온 ${loaded.toLocaleString()}${unit} 중 ${shown.toLocaleString()}${unit}`
    : `검색 결과 ${(total ?? shown).toLocaleString()}${unit} · ${shown.toLocaleString()}${unit} 표시`}</div>;
}

// 폰에서는 필터가 화면을 다 차지해 정작 데이터가 첫 화면에서 밀려난다.
// 검색은 밖에 두고, 나머지 필터만 접었다 펼친다.
export function AdminFilterBar({ applied, children }: { applied: number; children: ReactNode }) {
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const [open, setOpen] = useState(false);
  if (!compact) return <>{children}</>;
  return (
    <div className="admin-filter-shell">
      <button type="button" className="admin-filter-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        필터{applied > 0 ? ` · ${applied}개 적용` : ' · 전체'}
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="admin-filter-panel">{children}</div>}
    </div>
  );
}

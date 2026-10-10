import { useEffect, useRef, useState } from 'react';
import { useSkuSearch } from '../../api/hooks';
import { cx, Spinner, useDebounced } from '../ui';

/** SKU field with autocomplete on GET /skus?q= */
export function SkuInput({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(value, 200);
  const search = useSkuSearch(open ? dq : '');
  const ref = useRef<HTMLDivElement>(null);
  const items = search.data?.items ?? [];
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => setActive(0), [dq]);
  return (
    <div className="relative" ref={ref}>
      <input
        className={cx('input', invalid && 'invalid')}
        value={value}
        placeholder="SKU-00001"
        aria-label="SKU"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onChange(items[active].sku);
            setOpen(false);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && dq.length >= 2 && (
        <div className="popover absolute left-0 right-0 top-[40px] z-[50] max-h-[280px] min-w-[260px] overflow-y-auto py-s">
          {search.isFetching && items.length === 0 ? (
            <div className="flex items-center gap-m px-l py-m text-xs text-neutral-500">
              <Spinner size={14} /> Recherche
            </div>
          ) : items.length === 0 ? (
            <div className="px-l py-m text-xs text-neutral-500">Aucun SKU</div>
          ) : (
            items.map((s, i) => (
              <button
                key={s.sku}
                type="button"
                className={cx('flex w-full flex-col items-start px-l py-s text-left hover:bg-neutral-30', i === active && 'bg-neutral-30')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.sku);
                  setOpen(false);
                }}
              >
                <span className="text-s font-medium text-neutral-800">{s.sku}</span>
                <span className="text-xs text-neutral-500">
                  {s.name} · {s.category} · {s.weightKg} kg
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

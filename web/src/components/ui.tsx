import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, errorMessage } from '../api/client';
import type { BadgeColor } from '../lib/labels';
import { WEEKDAYS } from '../lib/labels';
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconInfo, IconSpinner, IconTrash } from './Icons';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Feedback

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <IconSpinner size={size} className={cx('os-spin', className ?? 'text-primary')} />;
}

export function Loading({ label = 'Chargement', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-m py-3xl text-s text-neutral-500', className)} role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

type AlertKind = 'error' | 'warning' | 'info' | 'success';
const ALERT_STYLE: Record<AlertKind, { bg: string; fg: string; Icon: typeof IconAlert }> = {
  error: { bg: 'var(--red-t-100)', fg: 'var(--red-1000)', Icon: IconAlert },
  warning: { bg: 'var(--orange-t-100)', fg: '#c35f0b', Icon: IconAlert },
  info: { bg: 'var(--blue-t-100)', fg: '#1c78c6', Icon: IconInfo },
  success: { bg: 'var(--green-t-100)', fg: 'var(--green-1000)', Icon: IconCheck },
};

/** OsAlert: tinted banner with icon, title and message. */
export function Alert({ kind = 'info', title, children, className, onClose }: { kind?: AlertKind; title?: ReactNode; children?: ReactNode; className?: string; onClose?: () => void }) {
  const s = ALERT_STYLE[kind];
  return (
    <div className={cx('flex items-start gap-m rounded-m px-l py-m text-s', className)} style={{ background: s.bg }} role={kind === 'error' ? 'alert' : 'status'}>
      <s.Icon size={20} style={{ color: s.fg, flex: 'none', marginTop: 1 }} />
      <div className="min-w-0 flex-1 text-neutral-800">
        {title && <div className="font-medium" style={{ color: s.fg }}>{title}</div>}
        {children && <div className="break-words">{children}</div>}
      </div>
      {onClose && (
        <button className="btn btn-tertiary btn-sm btn-icon" onClick={onClose} aria-label="Fermer">
          <IconClose />
        </button>
      )}
    </div>
  );
}

export function ErrorAlert({ error, title = 'Erreur', className }: { error: unknown; title?: string; className?: string }) {
  if (!error) return null;
  const fields = error instanceof ApiError ? error.fieldErrors : [];
  return (
    <Alert kind="error" title={title} className={className}>
      {errorMessage(error)}
      {fields.length > 0 && (
        <ul className="mt-s list-disc pl-xl">
          {fields.map((f, i) => (
            <li key={i}>
              <span className="font-medium">{f.field}</span> : {f.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Badge({ color = 'grey', children, className, title }: { color?: BadgeColor; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx('badge', `badge-${color}`, className)} title={title}>
      {children}
    </span>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="inline-block flex-none rounded-round" style={{ width: size, height: size, background: color }} />;
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-s px-xl py-3xl text-center">
      {icon && <div className="mb-s text-neutral-300">{icon}</div>}
      <div className="text-s font-medium text-neutral-700">{title}</div>
      {children && <div className="max-w-md text-xs text-neutral-500">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts

interface ToastItem {
  id: number;
  kind: AlertKind;
  text: string;
}
const ToastCtx = createContext<(text: string, kind?: AlertKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: AlertKind = 'success') => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, kind, text }]);
    window.setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-xl right-xl z-[2000] flex flex-col gap-m">
        {items.map((t) => {
          const s = ALERT_STYLE[t.kind];
          return (
            <div key={t.id} className="popover pointer-events-auto flex min-w-[220px] max-w-[380px] items-center gap-m px-l py-m text-s" role="status">
              <s.Icon size={18} style={{ color: s.fg }} />
              <span className="text-neutral-800">{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-xl flex flex-wrap items-start justify-between gap-l">
      <div className="min-w-0">
        <h1 className="os-title-l m-0">{title}</h1>
        {subtitle && <p className="m-0 mt-s text-s text-neutral-500">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-m">{actions}</div>}
    </div>
  );
}

export function Card({ title, icon, actions, children, className, bodyClassName }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <div className="card-header">
          <h2 className="os-title-s m-0 flex min-w-0 items-center gap-m">
            {icon && <span className="text-neutral-700">{icon}</span>}
            <span className="truncate">{title}</span>
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-m">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName ?? 'card-pad'}>{children}</div>
    </section>
  );
}

export function Kpi({ value, label, hint, accent }: { value: ReactNode; label: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="card px-xl py-l">
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="mt-xs text-2xs text-neutral-500">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination ("1 - 25 / 150", page size, arrows)

export function Pagination({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50, 100] }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void; sizes?: number[] }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center gap-l text-xs text-neutral-500">
      <span className="whitespace-nowrap text-neutral-800" data-testid="pagination-label">
        {from} - {to} / {total.toLocaleString('fr-FR').replace(/ | /g, ' ')}
      </span>
      {onPageSize && (
        <label className="flex items-center gap-s">
          <span className="hidden sm:inline">Par page</span>
          <select className="select h-[28px] w-[72px] px-m text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center">
        <button className="btn btn-tertiary btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
          <IconChevronLeft />
        </button>
        <button className="btn btn-tertiary btn-sm btn-icon" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label="Page suivante">
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls

export function Field({ label, error, hint, children, className, htmlFor }: { label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-m text-s', disabled ? 'cursor-default' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-m text-s">
      <input type="checkbox" className="h-[16px] w-[16px] accent-[#24bdb0]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function WeekdayToggles({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-s" role="group">
      {WEEKDAYS.map((d) => {
        const on = value.includes(d.n);
        return (
          <button
            key={d.n}
            type="button"
            title={d.long}
            aria-label={d.long}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d.n) : [...value, d.n].sort((a, b) => a - b))}
            className={cx('h-[32px] w-[32px] rounded-round border text-xs font-medium', on ? 'border-primary bg-primary text-white' : 'border-border bg-white text-neutral-700 hover:bg-neutral-30')}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

/** Multi select rendered as toggle chips. */
export function ChipSelect({ options, value, onChange, renderLabel }: { options: string[]; value: string[]; onChange: (v: string[]) => void; renderLabel?: (o: string) => ReactNode }) {
  return (
    <div className="flex flex-wrap gap-s">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" className="chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {on && <IconCheck size={14} />}
            {renderLabel ? renderLabel(o) : o}
          </button>
        );
      })}
    </div>
  );
}

/** Comma separated list input bound to string[]. */
export function ListInput({ value, onChange, placeholder, invalid, id }: { value: string[] | undefined | null; onChange: (v: string[]) => void; placeholder?: string; invalid?: boolean; id?: string }) {
  const [text, setText] = useState((value ?? []).join(', '));
  const last = useRef((value ?? []).join(','));
  useEffect(() => {
    const j = (value ?? []).join(',');
    if (j !== last.current) {
      last.current = j;
      setText((value ?? []).join(', '));
    }
  }, [value]);
  return (
    <input
      id={id}
      className={cx('input', invalid && 'invalid')}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const arr = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        last.current = arr.join(',');
        onChange(arr);
      }}
    />
  );
}

export function NumberInput({ value, onChange, step, min, max, invalid, id, placeholder }: { value: number | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; invalid?: boolean; id?: string; placeholder?: string }) {
  return (
    <input
      id={id}
      type="number"
      className={cx('input', invalid && 'invalid')}
      value={value === undefined || Number.isNaN(value) ? '' : value}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}

// ---------------------------------------------------------------------------
// Overlays

export function Drawer({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full flex-col bg-white" style={{ maxWidth: width, boxShadow: 'var(--shadow-floating-container)' }} role="dialog" aria-modal="true">
        <header className="flex h-[56px] flex-none items-center justify-between border-b border-border px-xl">
          <h2 className="os-title-m m-0 truncate">{title}</h2>
          <button className="btn btn-tertiary btn-icon" onClick={onClose} aria-label="Fermer">
            <IconClose />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-xl">{children}</div>
        {footer && <footer className="flex flex-none items-center justify-end gap-m border-t border-border px-xl py-l">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1600] flex items-center justify-center p-xl">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="popover relative flex max-h-full w-full flex-col" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <header className="flex flex-none items-center justify-between border-b border-border px-xl py-l" style={{ background: 'var(--pop-in-header)' }}>
          <h2 className="os-title-s m-0">{title}</h2>
          <button className="btn btn-tertiary btn-sm btn-icon" onClick={onClose} aria-label="Fermer">
            <IconClose />
          </button>
        </header>
        <div className="overflow-y-auto p-xl">{children}</div>
        {footer && <footer className="flex flex-none items-center justify-end gap-m border-t border-border px-xl py-l">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Two-step inline confirmation (no window.confirm). */
export function ConfirmButton({ onConfirm, label = 'Supprimer', confirmLabel = 'Confirmer la suppression', pending, iconOnly, small = true }: { onConfirm: () => void; label?: string; confirmLabel?: string; pending?: boolean; iconOnly?: boolean; small?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  if (armed)
    return (
      <span className="inline-flex items-center gap-s" onClick={(e) => e.stopPropagation()}>
        <button
          className={cx('btn btn-danger', small && 'btn-sm')}
          disabled={pending}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {pending ? <Spinner size={14} /> : null}
          {confirmLabel}
        </button>
        <button className={cx('btn btn-tertiary', small && 'btn-sm')} onClick={() => setArmed(false)}>
          Annuler
        </button>
      </span>
    );
  return (
    <button
      className={cx('btn btn-tertiary-red', small && 'btn-sm', iconOnly && 'btn-icon')}
      onClick={(e) => {
        e.stopPropagation();
        setArmed(true);
      }}
      title={label}
      aria-label={label}
    >
      <IconTrash />
      {!iconOnly && label}
    </button>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Rechercher', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <input className="input pr-[36px]" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      <svg className="pointer-events-none absolute right-l top-1/2 -translate-y-1/2 text-neutral-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </svg>
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-m">
      <div className="h-[6px] flex-1 overflow-hidden rounded-round bg-neutral-50">
        <div className="h-full rounded-round bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-[36px] text-right text-xs tabular-nums text-neutral-700">{value.toFixed(2)}</span>
    </div>
  );
}

/** Small key/value definition list. */
export function DL({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: number }) {
  return (
    <dl className="m-0 grid gap-x-xl gap-y-m" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-neutral-500">{k}</dt>
          <dd className="m-0 truncate text-s text-neutral-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Button opening a floating panel rendered in a portal (not clipped by scrolling tables). */
export function PopoverButton({ label, children, className, title, width = 300, testId }: { label: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); className?: string; title?: string; width?: number; testId?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setPos(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [pos, close]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
    setPos({ top: r.bottom + window.scrollY + 4, left: left + window.scrollX });
  };
  return (
    <>
      <button ref={btn} type="button" className={className ?? 'btn btn-tertiary btn-sm'} onClick={toggle} title={title} aria-label={title} aria-expanded={!!pos} data-testid={testId}>
        {label}
      </button>
      {pos &&
        createPortal(
          <div ref={panel} className="popover absolute z-[1700] p-l" style={{ top: pos.top, left: pos.left, width }}>
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Optional number input: empty string = undefined (open bound). */
export function OptNumberInput({ value, onChange, placeholder, step, invalid, className, ariaLabel }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; step?: number; invalid?: boolean; className?: string; ariaLabel?: string }) {
  return (
    <input
      type="number"
      className={cx('input', invalid && 'invalid', className)}
      value={value === undefined || value === null || Number.isNaN(value) ? '' : value}
      step={step ?? 'any'}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/** Segmented control (OneStock tabs-like toggle). */
export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('segmented', className)} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Field errors whose name starts with a prefix (after an optional root such as "rateCard."). */
export function errorsUnder(err: unknown, prefix: string, roots: string[] = []): FieldErrorLike[] {
  if (!(err instanceof ApiError)) return [];
  return err.fieldErrors
    .map((f) => {
      let field = f.field;
      for (const r of roots) if (field.startsWith(r + '.')) field = field.slice(r.length + 1);
      return { field, message: f.message };
    })
    .filter((f) => f.field === prefix || f.field.startsWith(prefix + '.') || f.field.startsWith(prefix + '['));
}
export interface FieldErrorLike {
  field: string;
  message: string;
}

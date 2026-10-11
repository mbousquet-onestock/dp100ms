import { useEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAdminToken, useAuthCheck, useHealth } from '../api/hooks';
import { DEFAULT_TOKEN } from '../api/client';
import {
  IconBox,
  IconChart,
  IconEuro,
  IconLayers,
  IconTool,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDocs,
  IconFlask,
  IconGauge,
  IconHub,
  IconLock,
  IconMenu,
  IconPlay,
  IconRoute,
  IconSettings,
  IconStore,
  IconTag,
  IconTruck,
} from './Icons';
import { cx, Spinner } from './ui';

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  end?: boolean;
}

const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Tableau de bord', Icon: IconGauge, end: true }] },
  {
    section: 'Promesse',
    items: [
      { to: '/simulator', label: 'Simulateur', Icon: IconPlay },
      { to: '/scenarios', label: 'Scénarios', Icon: IconFlask },
    ],
  },
  {
    section: 'Réseau logistique',
    items: [
      { to: '/stock-points', label: 'Points de stock', Icon: IconStore },
      { to: '/network', label: 'Routes et réseau', Icon: IconRoute },
      { to: '/hubs', label: 'Hubs', Icon: IconHub },
      { to: '/carriers', label: 'Transporteurs', Icon: IconTruck },
      { to: '/delivery-modes', label: 'Modes de livraison', Icon: IconTag },
    ],
  },
  {
    section: 'Catalogue et tarification',
    items: [
      { to: '/skus', label: 'Articles', Icon: IconBox },
      { to: '/rate-cards', label: 'Grilles tarifaires', Icon: IconEuro },
      { to: '/additional-services', label: 'Services associés', Icon: IconTool },
      { to: '/stock-views', label: 'Vues de stock', Icon: IconLayers },
    ],
  },
  {
    section: 'Performance',
    items: [{ to: '/benchmarks', label: 'Benchmarks', Icon: IconChart }],
  },
  {
    section: 'Plateforme',
    items: [
      { to: '/docs', label: 'Documentation API', Icon: IconDocs },
      { to: '/settings', label: 'Paramètres', Icon: IconSettings },
    ],
  },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('dp.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('dp.sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const sidebarW = collapsed ? 64 : 240;
  return (
    <div className="min-h-full">
      <TopBar onMenu={() => setDrawer((d) => !d)} />
      {/* Desktop sidebar */}
      <aside className="fixed bottom-0 left-0 top-[48px] z-[900] hidden flex-col bg-chrome md:flex" style={{ width: sidebarW }}>
        <SideNav collapsed={collapsed} />
        <button
          className="flex h-[44px] flex-none items-center gap-m border-t border-white/10 px-[22px] text-xs text-white/70 hover:bg-white/5 hover:text-white"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
        >
          {collapsed ? <IconChevronRight size={20} /> : <IconChevronLeft size={20} />}
          {!collapsed && <span>Replier le menu</span>}
        </button>
      </aside>
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 top-[48px] z-[1200] md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <aside className="relative flex h-full w-[260px] flex-col bg-chrome">
            <SideNav collapsed={false} />
          </aside>
        </div>
      )}
      <main className="pt-[48px] transition-none md:pl-[var(--sbw)]" style={{ ['--sbw' as string]: `${sidebarW}px` }}>
        <div className="mx-auto w-full max-w-[1680px] px-l py-xl sm:px-2xl sm:py-2xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SideNav({ collapsed }: { collapsed: boolean }) {
  return (
    <nav className="flex-1 overflow-y-auto overflow-x-hidden py-m" aria-label="Navigation principale">
      {NAV.map((g, gi) => (
        <div key={gi} className="mb-s">
          {g.section &&
            (collapsed ? (
              <div className="mx-l my-m border-t border-white/10" />
            ) : (
              <div className="px-xl pb-s pt-l text-2xs font-medium text-white/50">{g.section}</div>
            ))}
          {g.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              title={collapsed ? it.label : undefined}
              className={({ isActive }) =>
                cx(
                  'mx-m my-xs flex h-[40px] items-center gap-l rounded-m px-l text-s',
                  isActive ? 'bg-primary font-medium text-white' : 'text-white/80 hover:bg-white/5 hover:text-white',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              <it.Icon size={20} />
              {!collapsed && <span className="truncate">{it.label}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const health = useHealth();
  const platform = health.data?.platform;
  return (
    <header className="fixed left-0 right-0 top-0 z-[1000] flex h-[48px] items-center gap-l bg-chrome px-l text-white">
      <button className="btn btn-icon btn-sm text-white hover:bg-white/10 md:hidden" onClick={onMenu} aria-label="Menu">
        <IconMenu />
      </button>
      <div className="flex min-w-0 items-center gap-l">
        <span className="text-m font-medium tracking-normal text-white">OneStock</span>
        <span className="hidden h-[20px] w-px bg-white/30 sm:block" />
        <span className="hidden truncate text-s text-white/80 sm:block">Delivery Promise</span>
      </div>
      {platform && (
        <span className="hidden items-center gap-s rounded-l bg-white/10 px-m py-xs text-xs text-white/90 sm:inline-flex" title={`Seed ${health.data?.seed} · ${health.data?.stockLines?.toLocaleString('fr-FR')} lignes de stock`}>
          <span className="inline-block h-[8px] w-[8px] rounded-round" style={{ background: health.data?.status === 'ok' ? '#43a047' : '#f44539' }} />
          {platform}
        </span>
      )}
      {health.isError && <span className="rounded-l bg-white/10 px-m py-xs text-xs text-white/90">API injoignable</span>}
      <div className="flex-1" />
      <TokenControl />
    </header>
  );
}

function TokenControl() {
  const [token, setToken] = useAdminToken();
  const check = useAuthCheck(token);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(token);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(token), [token]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const state = check.isLoading ? 'loading' : check.data ? 'ok' : 'ko';
  return (
    <div className="relative" ref={ref}>
      <button className="flex h-[32px] items-center gap-m rounded-m px-m text-s text-white/90 hover:bg-white/10" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="token-button">
        <IconLock size={18} />
        <span className="hidden sm:inline">Jeton admin</span>
        {state === 'loading' ? (
          <Spinner size={14} />
        ) : (
          <span className="inline-block h-[8px] w-[8px] rounded-round" style={{ background: state === 'ok' ? '#43a047' : '#f44539' }} title={state === 'ok' ? 'Jeton valide' : 'Jeton invalide'} />
        )}
      </button>
      {open && (
        <div className="popover absolute right-0 top-[40px] w-[320px] p-l text-neutral-800">
          <div className="mb-m flex items-center justify-between">
            <span className="os-title-s">Jeton d'administration</span>
            <button className="btn btn-tertiary btn-sm btn-icon" onClick={() => setOpen(false)} aria-label="Fermer">
              <IconClose />
            </button>
          </div>
          <p className="m-0 mb-m text-xs text-neutral-500">Requis pour les opérations d'écriture (création, modification, suppression, benchmarks). Stocké localement dans le navigateur.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setToken(draft.trim());
            }}
            className="flex gap-s"
          >
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Jeton admin" type="password" autoComplete="off" />
            <button className="btn btn-primary" type="submit">
              Valider
            </button>
          </form>
          <div className="mt-m flex items-center justify-between text-xs">
            <span style={{ color: state === 'ok' ? 'var(--green-1000)' : state === 'ko' ? 'var(--red-1000)' : undefined }}>
              {state === 'loading' ? 'Vérification' : state === 'ok' ? 'Jeton valide' : 'Jeton refusé par l’API'}
            </span>
            <button className="text-xs text-neutral-500 underline" onClick={() => setToken(DEFAULT_TOKEN)} type="button">
              Valeur par défaut
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


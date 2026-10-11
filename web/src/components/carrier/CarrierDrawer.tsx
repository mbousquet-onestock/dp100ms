import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { useCrud } from '../../api/hooks';
import type { Carrier } from '../../api/types';
import { IconTruck } from '../Icons';
import { cx, Drawer, ErrorAlert, Field, Spinner, Switch, useToast } from '../ui';
import { cleanCarrier } from './shared';

/** Round carrier icon: logo when set, truck otherwise. */
export function CarrierIcon({ carrier, size = 48 }: { carrier: Pick<Carrier, 'logoUrl' | 'name'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (carrier.logoUrl && !broken)
    return (
      <span className="flex flex-none items-center justify-center overflow-hidden rounded-m border border-border bg-white" style={{ width: size, height: size }}>
        <img src={carrier.logoUrl} alt={carrier.name} className="h-full w-full object-contain" onError={() => setBroken(true)} />
      </span>
    );
  return (
    <span className="round-icon" style={{ width: size, height: size }}>
      <IconTruck size={Math.round(size * 0.46)} />
    </span>
  );
}

export function CarrierDrawer({
  state,
  onClose,
  crud,
  onSaved,
}: {
  state: { v: Carrier; isNew: boolean } | null;
  onClose: () => void;
  crud: ReturnType<typeof useCrud<Carrier>>;
  onSaved?: (c: Carrier) => void;
}) {
  const [v, setV] = useState<Carrier>({ id: '', name: '', active: true });
  const toast = useToast();
  const m = state?.isNew ? crud.create : crud.update;
  useEffect(() => {
    if (state) {
      setV(state.v);
      crud.create.reset();
      crud.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const fe = m.error instanceof ApiError ? m.error.byField : {};
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.isNew ? 'Nouveau transporteur' : `Transporteur ${state?.v.id}`}
      width={440}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={m.isPending}
            data-testid="save-carrier"
            onClick={() =>
              m.mutate(cleanCarrier({ ...v, logoUrl: v.logoUrl?.trim() || undefined }), {
                onSuccess: (saved) => {
                  toast('Enregistré');
                  onClose();
                  onSaved?.(saved);
                },
              })
            }
          >
            {m.isPending && <Spinner size={16} className="text-white" />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-l">
        {m.error ? <ErrorAlert error={m.error} title="Enregistrement impossible" /> : null}
        <Field label="Identifiant" error={fe.id}>
          <input className={cx('input', fe.id && 'invalid')} value={v.id} disabled={!state?.isNew} onChange={(e) => setV({ ...v, id: e.target.value })} aria-label="Identifiant" />
        </Field>
        <Field label="Nom" error={fe.name}>
          <input className={cx('input', fe.name && 'invalid')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Nom" />
        </Field>
        <Field label="URL du logo" hint="Optionnel ; une icône camion est affichée sinon" error={fe.logoUrl}>
          <div className="flex items-center gap-m">
            <CarrierIcon carrier={v} size={36} />
            <input className={cx('input', fe.logoUrl && 'invalid')} value={v.logoUrl ?? ''} onChange={(e) => setV({ ...v, logoUrl: e.target.value })} placeholder="https://…/logo.png" />
          </div>
        </Field>
        <Switch checked={v.active} onChange={(b) => setV({ ...v, active: b })} label={v.active ? 'Actif' : 'Inactif'} />
      </div>
    </Drawer>
  );
}

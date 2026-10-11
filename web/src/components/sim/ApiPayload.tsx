import { useMemo, useState } from 'react';
import type { PromiseRequest, SimulationResponse } from '../../api/types';
import { ApiError } from '../../api/client';
import { Card, Segmented, useToast } from '../ui';

type Tab = 'request' | 'response' | 'curl';

/** The public promise response: the simulator response without its
 * display context (request echo, node names, stock summary, server time). */
export function promiseResponse(r: SimulationResponse): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { request, nodes, stock, serverTimeMs, ...rest } = r as SimulationResponse & Record<string, unknown>;
  return rest;
}

/** API payloads of the last calculation: the POST /api/v1/delivery-promises
 * body sent, and the response received (or the RFC 7807 error). */
export function ApiPayload({ request, response, error, status }: { request: PromiseRequest | null; response: SimulationResponse | null; error: unknown; status?: number }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('request');
  const [open, setOpen] = useState(true);
  const url = `${window.location.origin}/api/v1/delivery-promises`;
  const reqText = useMemo(() => (request ? JSON.stringify(request, null, 2) : ''), [request]);
  const respText = useMemo(() => {
    if (error instanceof ApiError) return JSON.stringify(error.problem ?? { status: error.status, detail: error.message }, null, 2);
    return response ? JSON.stringify(promiseResponse(response), null, 2) : '';
  }, [response, error]);
  const curl = request ? `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(request).replace(/'/g, "'\\''")}'` : '';
  if (!request) return null;
  const text = tab === 'request' ? reqText : tab === 'response' ? respText : curl;
  const code = error instanceof ApiError ? error.status : status ?? 200;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copié dans le presse-papiers');
    } catch {
      toast('Copie impossible : sélectionnez le texte', 'warning');
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: tab === 'curl' ? 'text/plain' : 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tab === 'request' ? 'delivery-promise-request.json' : tab === 'response' ? 'delivery-promise-response.json' : 'delivery-promise.sh';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const size = new Blob([respText]).size;
  return (
    <Card
      title="Payload API"
      actions={
        <button className="btn btn-tertiary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Masquer' : 'Afficher'}
        </button>
      }
      bodyClassName="card-pad"
    >
      <div className="mb-m flex flex-wrap items-center gap-m text-sm">
        <span className="rounded-[5px] bg-primary-tint px-s py-xs font-mono text-xs font-medium text-primary">POST</span>
        <code className="min-w-0 break-all text-xs text-neutral-700">/api/v1/delivery-promises</code>
        <span className={code < 300 ? 'text-xs font-medium text-green' : 'text-xs font-medium text-red'}>
          {code} {code < 300 ? 'OK' : 'Erreur'}
        </span>
        {response && !error ? <span className="text-xs text-neutral-500">{(size / 1024).toFixed(1)} Ko</span> : null}
      </div>
      {open && (
        <>
          <div className="mb-m flex flex-wrap items-center justify-between gap-m">
            <Segmented<Tab>
              options={[
                { value: 'request', label: 'Requête envoyée' },
                { value: 'response', label: error ? 'Erreur reçue' : 'Réponse reçue' },
                { value: 'curl', label: 'cURL' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="flex gap-s">
              <button className="btn btn-secondary btn-sm" onClick={copy} data-testid="payload-copy">
                Copier
              </button>
              <button className="btn btn-secondary btn-sm" onClick={download}>
                Télécharger
              </button>
            </div>
          </div>
          <pre className="max-h-[480px] overflow-auto rounded-[5px] border border-neutral-200 bg-neutral-50 p-m font-mono text-xs leading-relaxed text-neutral-800" data-testid={`payload-${tab}`}>
            {text}
          </pre>
          <p className="m-0 mt-s text-xs text-neutral-500">
            {tab === 'response'
              ? 'Réponse de l’API publique POST /api/v1/delivery-promises (le simulateur reçoit en plus les noms des sites et le résumé du stock pour l’affichage).'
              : 'Corps envoyé à l’API ; le même JSON fonctionne dans Postman ou en cURL.'}
          </p>
        </>
      )}
    </Card>
  );
}

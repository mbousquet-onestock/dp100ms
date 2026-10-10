import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tokenStore } from '../api/client';
import { qk } from '../api/hooks';
import { IconChevronDown, IconChevronRight, IconCopy, IconExternal, IconLock, IconPlay, IconUnlock } from '../components/Icons';
import { Markdown } from '../components/Markdown';
import { Alert, Badge, Card, cx, EmptyState, ErrorAlert, Loading, PageHeader, SearchInput, Spinner, useToast } from '../components/ui';
import type { BadgeColor } from '../lib/labels';
import { anchorId, exampleFor, jsonMedia, mediaExample, mergeAllOf, operations, refName, resolveRef, typeLabel, type Json, type Method, type OpenApiDoc, type Operation } from '../lib/openapi';

const METHOD_COLOR: Record<Method, BadgeColor> = { get: 'blue', post: 'green', put: 'orange', patch: 'purple', delete: 'red' };

function MethodBadge({ m, className }: { m: Method; className?: string }) {
  return (
    <Badge color={METHOD_COLOR[m]} className={cx('w-[58px] justify-center font-medium', className)}>
      {m.toUpperCase()}
    </Badge>
  );
}

export default function Docs() {
  const spec = useQuery({
    queryKey: qk.openapi,
    queryFn: async () => {
      const r = await fetch('/api/v1/openapi.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as OpenApiDoc;
    },
    staleTime: 300000,
  });
  const [q, setQ] = useState('');
  const doc = spec.data;
  const ops = useMemo(() => (doc ? operations(doc) : []), [doc]);
  const groups = useMemo(() => {
    const tagOrder = (doc?.tags ?? []).map((t) => t.name);
    const m = new Map<string, Operation[]>();
    tagOrder.forEach((t) => m.set(t, []));
    const lq = q.toLowerCase();
    for (const o of ops) {
      if (lq && !`${o.method} ${o.path} ${o.op.summary ?? ''} ${o.tag}`.toLowerCase().includes(lq)) continue;
      if (!m.has(o.tag)) m.set(o.tag, []);
      m.get(o.tag)!.push(o);
    }
    return [...m.entries()].filter(([, v]) => v.length > 0);
  }, [ops, doc, q]);
  const schemas = Object.keys(doc?.components?.schemas ?? {}).sort();

  if (spec.isLoading) return <Loading />;
  if (spec.error) return <ErrorAlert error={spec.error} title="Spécification OpenAPI indisponible" />;
  if (!doc) return null;

  const baseUrl = `${window.location.origin}/api/v1`;
  return (
    <div>
      <PageHeader
        title={doc.info?.title ?? 'Documentation API'}
        subtitle={`Référence de l'API REST ${doc.info?.version ? `· version ${doc.info.version}` : ''} ${doc.openapi ? `· OpenAPI ${doc.openapi}` : ''}`}
        actions={
          <a className="btn btn-secondary" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            <IconExternal /> openapi.json
          </a>
        }
      />
      <div className="grid gap-l lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Navigation */}
        <nav className="card self-start lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto" aria-label="Sommaire de l'API">
          <div className="border-b border-border p-m">
            <SearchInput value={q} onChange={setQ} placeholder="Filtrer les endpoints" />
          </div>
          <div className="py-s">
            <a href="#intro" className="block px-l py-s text-s font-medium text-neutral-800 hover:bg-neutral-30">
              Introduction
            </a>
            {groups.map(([tag, list]) => (
              <div key={tag} className="mt-s">
                <a href={`#tag-${tag}`} className="block px-l py-s text-xs font-medium text-grey-800 hover:bg-neutral-30">
                  {tag}
                </a>
                {list.map((o) => (
                  <a key={o.key} href={`#${anchorId(o.key)}`} className="flex items-center gap-m px-l py-xs text-xs text-neutral-700 hover:bg-neutral-30" title={o.op.summary}>
                    <MethodBadge m={o.method} className="h-[18px] w-[50px] text-2xs" />
                    <span className="truncate">{o.op.summary ?? o.path}</span>
                  </a>
                ))}
              </div>
            ))}
            {schemas.length > 0 && (
              <a href="#schemas" className="mt-s block px-l py-s text-xs font-medium text-grey-800 hover:bg-neutral-30">
                Schémas ({schemas.length})
              </a>
            )}
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-l">
          <Intro doc={doc} baseUrl={baseUrl} count={ops.length} />
          {ops.length === 0 && (
            <Card>
              <EmptyState title="Aucun endpoint documenté">La spécification OpenAPI servie par /api/v1/openapi.json ne contient encore aucun chemin.</EmptyState>
            </Card>
          )}
          {groups.map(([tag, list]) => (
            <section key={tag} id={`tag-${tag}`} className="scroll-mt-[64px]">
              <h2 className="os-title-m mb-s mt-m">{tag}</h2>
              <Markdown text={doc.tags?.find((t) => t.name === tag)?.description} className="mb-m text-s text-neutral-500" />
              <div className="flex flex-col gap-l">
                {list.map((o) => (
                  <OperationView key={o.key} doc={doc} o={o} baseUrl={baseUrl} />
                ))}
              </div>
            </section>
          ))}
          {schemas.length > 0 && (
            <section id="schemas" className="scroll-mt-[64px]">
              <h2 className="os-title-m mb-m mt-m">Schémas</h2>
              <div className="flex flex-col gap-m">
                {schemas.map((name) => (
                  <SchemaCard key={name} doc={doc} name={name} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Intro({ doc, baseUrl, count }: { doc: OpenApiDoc; baseUrl: string; count: number }) {
  const schemes = Object.entries(doc.components?.securitySchemes ?? {});
  return (
    <Card title="Introduction" className="scroll-mt-[64px]" bodyClassName="card-pad">
      <div id="intro" className="flex flex-col gap-l text-s text-neutral-800">
        <Markdown text={doc.info?.description} />
        <div className="grid gap-l md:grid-cols-2">
          <div>
            <div className="os-title-s mb-s">URL de base</div>
            <code className="code-block block">{(doc.servers?.[0]?.url && doc.servers[0].url !== '/' ? doc.servers[0].url : baseUrl).replace(/\/$/, '')}</code>
            <p className="m-0 mt-s text-xs text-neutral-500">
              {count} opérations. Toutes les routes sont préfixées par <code>/api/v1</code> (versionnage dans l'URL, changements incompatibles publiés sous un nouveau préfixe).
            </p>
          </div>
          <div>
            <div className="os-title-s mb-s">Authentification</div>
            <p className="m-0">
              Les lectures et le calcul de promesse sont publics. Les écritures (création, modification, suppression, benchmarks, administration) exigent un jeton porteur :
            </p>
            <code className="code-block mt-s block">Authorization: Bearer &lt;admin-token&gt;</code>
            {schemes.length > 0 && <p className="m-0 mt-s text-xs text-neutral-500">Schémas déclarés : {schemes.map(([k, v]) => `${k} (${v.type}${v.scheme ? ' ' + v.scheme : ''})`).join(', ')}</p>}
          </div>
          <div>
            <div className="os-title-s mb-s">Erreurs (RFC 7807)</div>
            <p className="m-0 mb-s">Les erreurs sont renvoyées en <code>application/problem+json</code>. Une erreur de validation (422) détaille chaque champ en cause.</p>
            <pre className="code-block m-0">{JSON.stringify({ type: 'https://dp100ms.onestock.dev/problems/validation-error', title: 'Unprocessable Entity', status: 422, detail: 'the request contains invalid fields', instance: '/api/v1/delivery-promises', errors: [{ field: 'items[0].sku', message: 'unknown sku SKU-X' }] }, null, 2)}</pre>
          </div>
          <div>
            <div className="os-title-s mb-s">Pagination</div>
            <p className="m-0 mb-s">
              Les listes acceptent <code>?page=</code> (à partir de 1) et <code>?pageSize=</code> (50 par défaut, 1000 max) et renvoient une enveloppe :
            </p>
            <pre className="code-block m-0">{JSON.stringify({ items: ['…'], page: 1, pageSize: 50, total: 120 }, null, 2)}</pre>
            <p className="m-0 mt-s text-xs text-neutral-500">Dates au format RFC 3339, heures locales au format « HH:MM », jours ouvrés numérotés de 1 (lundi) à 7 (dimanche).</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function OperationView({ doc, o, baseUrl }: { doc: OpenApiDoc; o: Operation; baseUrl: string }) {
  const toast = useToast();
  const [tryOpen, setTryOpen] = useState(false);
  const body = o.op.requestBody ? resolveRef(doc, o.op.requestBody) : null;
  const bodyMedia = body ? jsonMedia(body.content) : null;
  const bodyExample = bodyMedia ? mediaExample(doc, bodyMedia[1]) : undefined;
  const responses = Object.entries(o.op.responses ?? {}) as [string, Json][];

  const curl = () => {
    const path = o.path.replace(/\{(\w+)\}/g, (_, n) => {
      const p = o.params.find((x) => x.name === n);
      return String(p?.example ?? p?.schema?.example ?? `{${n}}`);
    });
    const parts = [`curl -X ${o.method.toUpperCase()} '${baseUrl.replace(/\/api\/v1$/, '')}${path.startsWith('/api') ? path : '/api/v1' + path}'`];
    if (o.secured) parts.push(`-H 'Authorization: Bearer ${tokenStore.get()}'`);
    if (bodyMedia) {
      parts.push(`-H 'Content-Type: ${bodyMedia[0]}'`);
      parts.push(`-d '${JSON.stringify(bodyExample ?? {})}'`);
    }
    return parts.join(' \\\n  ');
  };

  return (
    <article id={anchorId(o.key)} className="card scroll-mt-[64px]">
      <header className="flex flex-wrap items-center gap-m border-b border-border px-xl py-l">
        <MethodBadge m={o.method} />
        <code className="break-all text-s font-medium text-neutral-800">{o.path}</code>
        <span className="flex-1" />
        {o.secured ? (
          <Badge color="orange" title="Jeton admin requis">
            <IconLock /> Jeton admin
          </Badge>
        ) : (
          <Badge color="grey">
            <IconUnlock /> Public
          </Badge>
        )}
        {o.op.deprecated && <Badge color="red">Obsolète</Badge>}
      </header>
      <div className="flex flex-col gap-l px-xl py-l">
        {(o.op.summary || o.op.description) && (
          <div>
            {o.op.summary && <div className="os-title-s">{o.op.summary}</div>}
            <Markdown text={o.op.description} className="mt-s text-s text-neutral-700" />
          </div>
        )}

        {o.params.length > 0 && (
          <div>
            <div className="os-label mb-s font-medium">Paramètres</div>
            <div className="overflow-x-auto rounded-m border border-border">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Emplacement</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {o.params.map((p) => (
                    <tr key={`${p.in}-${p.name}`}>
                      <td className="whitespace-nowrap">
                        <code className="text-xs font-medium">{p.name}</code>
                        {p.required && <span className="ml-s text-2xs text-red">requis</span>}
                      </td>
                      <td className="text-xs">{p.in}</td>
                      <td className="text-xs">
                        <code>{typeLabel(doc, p.schema)}</code>
                        {p.schema?.enum && <div className="text-2xs text-neutral-500">{p.schema.enum.join(' | ')}</div>}
                      </td>
                      <td className="text-xs text-neutral-700">
                        {p.description}
                        {p.example !== undefined && <span className="text-neutral-500"> Ex. {String(p.example)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {bodyMedia && (
          <div>
            <div className="os-label mb-s font-medium">
              Corps de requête <code className="font-normal">{bodyMedia[0]}</code>
              {body?.required && <span className="ml-s text-red">requis</span>}
            </div>
            <Markdown text={body?.description} className="mb-s text-xs text-neutral-700" />
            <div className="grid gap-l xl:grid-cols-2">
              <SchemaTable doc={doc} schema={bodyMedia[1].schema} />
              {bodyExample !== undefined && <pre className="code-block m-0 max-h-[360px]">{JSON.stringify(bodyExample, null, 2)}</pre>}
            </div>
          </div>
        )}

        {responses.length > 0 && (
          <div>
            <div className="os-label mb-s font-medium">Réponses</div>
            <div className="flex flex-col gap-s">
              {responses.map(([code, r]) => (
                <ResponseRow key={code} doc={doc} code={code} resp={resolveRef(doc, r)} />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-m">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(curl()).then(
                () => toast('Commande curl copiée'),
                () => toast('Copie impossible', 'error'),
              );
            }}
          >
            <IconCopy /> Copier curl
          </button>
          <button className={cx('btn btn-sm', tryOpen ? 'btn-primary' : 'btn-secondary')} onClick={() => setTryOpen((t) => !t)}>
            <IconPlay /> Essayer
          </button>
        </div>
        {tryOpen && <TryIt o={o} bodyExample={bodyExample} contentType={bodyMedia?.[0]} />}
      </div>
    </article>
  );
}

function statusColor(code: string): BadgeColor {
  if (code.startsWith('2')) return 'green';
  if (code.startsWith('3')) return 'blue';
  if (code.startsWith('4')) return 'orange';
  if (code.startsWith('5')) return 'red';
  return 'grey';
}

function ResponseRow({ doc, code, resp }: { doc: OpenApiDoc; code: string; resp: Json }) {
  const [open, setOpen] = useState(code.startsWith('2'));
  const media = jsonMedia(resp?.content);
  const ex = media ? mediaExample(doc, media[1]) : undefined;
  return (
    <div className="rounded-m border border-border">
      <button className="flex w-full items-center gap-m px-l py-m text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open} disabled={!media}>
        {media ? open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} /> : <span className="w-[16px]" />}
        <Badge color={statusColor(code)}>{code}</Badge>
        <span className="text-s text-neutral-700">{resp?.description}</span>
        {media && (
          <code className="ml-auto text-2xs text-neutral-500">
            {media[0]} · {typeLabel(doc, media[1].schema)}
          </code>
        )}
      </button>
      {open && media && (
        <div className="grid gap-l border-t border-border p-l xl:grid-cols-2">
          <SchemaTable doc={doc} schema={media[1].schema} />
          {ex !== undefined && <pre className="code-block m-0 max-h-[360px]">{JSON.stringify(ex, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema rendering (recursive, cycle-safe)

function SchemaTable({ doc, schema }: { doc: OpenApiDoc; schema: Json }) {
  if (!schema) return <div className="text-xs text-neutral-500">Aucun schéma</div>;
  const resolved = mergeAllOf(doc, schema);
  const t = Array.isArray(resolved?.type) ? resolved.type.find((x: string) => x !== 'null') : resolved?.type;
  const isArray = t === 'array';
  const target = isArray ? mergeAllOf(doc, resolved.items) : resolved;
  const hasProps = target && (target.properties || target.oneOf || target.anyOf);
  return (
    <div className="min-w-0">
      <div className="mb-s text-xs text-neutral-500">
        Type <code className="text-neutral-800">{typeLabel(doc, schema)}</code>
        {schema.$ref && (
          <a href={`#schema-${refName(schema.$ref)}`} className="ml-s underline">
            voir le schéma
          </a>
        )}
      </div>
      {hasProps ? (
        <div className="overflow-x-auto rounded-m border border-border">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Propriété</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <PropRows doc={doc} schema={target} depth={0} stack={schema.$ref ? [schema.$ref] : isArray && resolved.items?.$ref ? [resolved.items.$ref] : []} />
            </tbody>
          </table>
        </div>
      ) : target?.enum ? (
        <div className="text-xs">Valeurs : {target.enum.map((e: Json) => <code key={String(e)} className="mr-s">{String(e)}</code>)}</div>
      ) : null}
    </div>
  );
}

function PropRows({ doc, schema, depth, stack }: { doc: OpenApiDoc; schema: Json; depth: number; stack: string[] }) {
  const s = mergeAllOf(doc, schema);
  if (s?.oneOf || s?.anyOf) {
    const variants: Json[] = s.oneOf ?? s.anyOf;
    return (
      <tr>
        <td colSpan={3} className="text-xs text-neutral-700" style={{ paddingLeft: 12 + depth * 16 }}>
          Une des variantes : {variants.map((v) => typeLabel(doc, v)).join(', ')}
        </td>
      </tr>
    );
  }
  const required: string[] = s?.required ?? [];
  return (
    <>
      {Object.entries(s?.properties ?? {}).map(([name, raw]) => (
        <PropRow key={name} doc={doc} name={name} raw={raw as Json} required={required.includes(name)} depth={depth} stack={stack} />
      ))}
    </>
  );
}

function PropRow({ doc, name, raw, required, depth, stack }: { doc: OpenApiDoc; name: string; raw: Json; required: boolean; depth: number; stack: string[] }) {
  const ref: string | undefined = raw?.$ref ?? raw?.items?.$ref ?? raw?.allOf?.[0]?.$ref;
  const cyclic = !!ref && stack.includes(ref);
  const resolved = mergeAllOf(doc, raw);
  const t = Array.isArray(resolved?.type) ? resolved.type.find((x: string) => x !== 'null') : resolved?.type;
  const child = t === 'array' ? mergeAllOf(doc, resolved.items) : resolved;
  const expandable = !cyclic && depth < 4 && !!child?.properties;
  const [open, setOpen] = useState(depth < 1 && expandable && Object.keys(child.properties).length <= 8);
  const desc = raw?.description ?? resolved?.description;
  const enumVals: Json[] | undefined = resolved?.enum ?? child?.enum;
  return (
    <Fragment>
      <tr>
        <td className="whitespace-nowrap" style={{ paddingLeft: 12 + depth * 16 }}>
          <span className="inline-flex items-center gap-xs">
            {expandable ? (
              <button className="text-neutral-500" onClick={() => setOpen((x) => !x)} aria-label={open ? 'Replier' : 'Déplier'}>
                {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </button>
            ) : (
              <span className="inline-block w-[14px]" />
            )}
            <code className="text-xs font-medium text-neutral-800">{name}</code>
            {required && <span className="text-2xs text-red">requis</span>}
          </span>
        </td>
        <td className="text-xs">
          <code>{typeLabel(doc, raw)}</code>
          {cyclic && <span className="ml-s text-2xs text-neutral-500">(récursif)</span>}
        </td>
        <td className="text-xs text-neutral-700">
          {desc}
          {enumVals && (
            <div className="mt-xs flex flex-wrap gap-xs">
              {enumVals.map((e) => (
                <code key={String(e)} className="rounded-s bg-neutral-50 px-xs text-2xs">
                  {String(e)}
                </code>
              ))}
            </div>
          )}
          {resolved?.example !== undefined && typeof resolved.example !== 'object' && <span className="text-neutral-500"> Ex. {String(resolved.example)}</span>}
        </td>
      </tr>
      {open && expandable && <PropRows doc={doc} schema={child} depth={depth + 1} stack={ref ? [...stack, ref] : stack} />}
    </Fragment>
  );
}

function SchemaCard({ doc, name }: { doc: OpenApiDoc; name: string }) {
  const [open, setOpen] = useState(false);
  const schema = doc.components!.schemas![name];
  return (
    <div id={`schema-${name}`} className="card scroll-mt-[64px]">
      <button className="flex w-full items-center gap-m px-xl py-l text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        {open ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
        <code className="text-s font-medium text-neutral-800">{name}</code>
        <span className="truncate text-xs text-neutral-500">{schema?.description}</span>
      </button>
      {open && (
        <div className="grid gap-l border-t border-border p-l xl:grid-cols-2">
          <SchemaTable doc={doc} schema={{ $ref: `#/components/schemas/${name}` }} />
          <pre className="code-block m-0 max-h-[360px]">{JSON.stringify(exampleFor(doc, schema, [`#/components/schemas/${name}`]), null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive console

function TryIt({ o, bodyExample, contentType }: { o: Operation; bodyExample: Json; contentType?: string }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const p of o.params) {
      const ex = p.example ?? p.schema?.example ?? p.schema?.default;
      if (ex !== undefined) v[`${p.in}:${p.name}`] = String(ex);
    }
    return v;
  });
  const [body, setBody] = useState(bodyExample !== undefined ? JSON.stringify(bodyExample, null, 2) : '');
  const [res, setRes] = useState<{ status: number; ms: number; text: string; ok: boolean; ct: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');

  const send = async () => {
    setErr('');
    let path = o.path;
    const qs = new URLSearchParams();
    for (const p of o.params) {
      const v = values[`${p.in}:${p.name}`];
      if (p.in === 'path') {
        if (!v) {
          setErr(`Paramètre de chemin manquant : ${p.name}`);
          return;
        }
        path = path.replace(`{${p.name}}`, encodeURIComponent(v));
      } else if (p.in === 'query' && v) qs.set(p.name, v);
    }
    const url = (path.startsWith('/api') ? path : '/api/v1' + path) + (qs.toString() ? `?${qs}` : '');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.secured) headers.Authorization = `Bearer ${tokenStore.get()}`;
    const init: RequestInit = { method: o.method.toUpperCase(), headers };
    if (contentType && body.trim()) {
      headers['Content-Type'] = contentType;
      init.body = body;
    }
    setPending(true);
    const t0 = performance.now();
    try {
      const r = await fetch(url, init);
      const text = await r.text();
      const ms = performance.now() - t0;
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON */
      }
      if (pretty.length > 200000) pretty = pretty.slice(0, 200000) + '\n…';
      setRes({ status: r.status, ms, text: pretty, ok: r.ok, ct: r.headers.get('content-type') ?? '' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const editable = o.params.filter((p) => p.in === 'path' || p.in === 'query');
  return (
    <div className="rounded-m border border-border bg-neutral-20 p-l">
      <div className="os-title-s mb-m">Essayer la requête</div>
      {o.secured && (
        <Alert kind="info" className="mb-m">
          Le jeton admin du navigateur est envoyé automatiquement (en-tête Authorization).
        </Alert>
      )}
      {editable.length > 0 && (
        <div className="mb-m grid gap-m sm:grid-cols-2">
          {editable.map((p) => (
            <label key={`${p.in}:${p.name}`} className="block">
              <span className="field-label">
                {p.name} <span className="font-normal text-neutral-500">({p.in})</span>
                {p.required && <span className="ml-s text-red">requis</span>}
              </span>
              {p.schema?.enum ? (
                <select className="select" value={values[`${p.in}:${p.name}`] ?? ''} onChange={(e) => setValues({ ...values, [`${p.in}:${p.name}`]: e.target.value })}>
                  <option value="" />
                  {p.schema.enum.map((x: Json) => (
                    <option key={String(x)}>{String(x)}</option>
                  ))}
                </select>
              ) : (
                <input className="input" value={values[`${p.in}:${p.name}`] ?? ''} onChange={(e) => setValues({ ...values, [`${p.in}:${p.name}`]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
      )}
      {contentType && (
        <label className="mb-m block">
          <span className="field-label">Corps ({contentType})</span>
          <textarea className="textarea font-code text-xs" rows={Math.min(18, Math.max(5, body.split('\n').length))} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
        </label>
      )}
      {err && <div className="field-error mb-m">{err}</div>}
      <button className="btn btn-primary btn-sm" onClick={send} disabled={pending}>
        {pending ? <Spinner size={14} className="text-white" /> : <IconPlay />}
        Envoyer
      </button>
      {res && (
        <div className="mt-l">
          <div className="mb-s flex flex-wrap items-center gap-m text-xs">
            <Badge color={statusColor(String(res.status))}>{res.status}</Badge>
            <span className="text-neutral-700">{res.ms.toFixed(1)} ms</span>
            <span className="text-neutral-500">{res.ct}</span>
          </div>
          <pre className="code-block m-0 max-h-[420px] bg-white">{res.text || '(corps vide)'}</pre>
        </div>
      )}
    </div>
  );
}

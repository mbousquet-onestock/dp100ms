// Minimal OpenAPI 3.x helpers: $ref resolution, schema typing, example generation.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

export interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, Json>>;
  components?: { schemas?: Record<string, Json>; securitySchemes?: Record<string, Json>; parameters?: Record<string, Json>; responses?: Record<string, Json>; requestBodies?: Record<string, Json>; examples?: Record<string, Json> };
  security?: Record<string, string[]>[];
}

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Method = (typeof METHODS)[number];

export interface Operation {
  key: string;
  method: Method;
  path: string;
  tag: string;
  op: Json;
  params: Json[];
  secured: boolean;
}

export function resolveRef(doc: OpenApiDoc, obj: Json): Json {
  let cur = obj;
  let guard = 0;
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string' && guard++ < 20) {
    cur = lookup(doc, cur.$ref);
  }
  return cur;
}

export function lookup(doc: OpenApiDoc, ref: string): Json {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<Json>((o, k) => (o == null ? undefined : o[k]), doc);
}

export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

export function operations(doc: OpenApiDoc): Operation[] {
  const out: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const shared: Json[] = (item.parameters ?? []).map((p: Json) => resolveRef(doc, p));
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const own: Json[] = (op.parameters ?? []).map((p: Json) => resolveRef(doc, p));
      const params = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
      const security = op.security ?? doc.security ?? [];
      out.push({
        key: `${method}-${path}`,
        method,
        path,
        tag: op.tags?.[0] ?? 'Autres',
        op,
        params,
        secured: Array.isArray(security) && security.some((s: Json) => Object.keys(s ?? {}).length > 0),
      });
    }
  }
  return out;
}

export function anchorId(key: string): string {
  return 'op-' + key.replace(/[^a-zA-Z0-9]+/g, '-');
}

export function typeLabel(doc: OpenApiDoc, schema: Json, depth = 0): string {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  if (depth > 5) return '…';
  if (schema.allOf) return schema.allOf.map((s: Json) => typeLabel(doc, s, depth + 1)).join(' & ');
  if (schema.oneOf) return schema.oneOf.map((s: Json) => typeLabel(doc, s, depth + 1)).join(' | ');
  if (schema.anyOf) return schema.anyOf.map((s: Json) => typeLabel(doc, s, depth + 1)).join(' | ');
  let t = schema.type;
  if (Array.isArray(t)) t = t.filter((x: string) => x !== 'null').join(' | ') + (schema.type.includes('null') ? ' | null' : '');
  if (t === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) return `array<${typeLabel(doc, schema.items, depth + 1)}>`;
  if (!t && schema.properties) t = 'object';
  if (!t && schema.additionalProperties) t = 'object';
  if (t === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.properties) {
    return `map<string, ${typeLabel(doc, schema.additionalProperties, depth + 1)}>`;
  }
  const fmt = schema.format ? ` (${schema.format})` : '';
  return (t ?? 'any') + fmt;
}

/** Flattens allOf into a single object schema (properties + required). */
export function mergeAllOf(doc: OpenApiDoc, schema: Json, seen = new Set<string>()): Json {
  if (!schema) return schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    const next = new Set(seen);
    next.add(schema.$ref);
    return mergeAllOf(doc, lookup(doc, schema.$ref), next);
  }
  if (!schema.allOf) return schema;
  const out: Json = { ...schema, allOf: undefined, properties: { ...(schema.properties ?? {}) }, required: [...(schema.required ?? [])] };
  for (const part of schema.allOf) {
    const m = mergeAllOf(doc, part, seen);
    Object.assign(out.properties, m?.properties ?? {});
    out.required.push(...(m?.required ?? []));
    if (!out.type && m?.type) out.type = m.type;
    if (!out.description && m?.description) out.description = m.description;
  }
  return out;
}

/** Builds an example value from a schema (example, default, enum, or by type). */
export function exampleFor(doc: OpenApiDoc, schema: Json, stack: string[] = []): Json {
  if (!schema) return null;
  if (schema.$ref) {
    if (stack.includes(schema.$ref) || stack.length > 6) return {};
    return exampleFor(doc, lookup(doc, schema.$ref), [...stack, schema.$ref]);
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.allOf) return exampleFor(doc, mergeAllOf(doc, schema), stack);
  if (schema.oneOf?.length) return exampleFor(doc, schema.oneOf[0], stack);
  if (schema.anyOf?.length) return exampleFor(doc, schema.anyOf[0], stack);
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== 'null') : schema.type;
  if (t === 'object' || (!t && schema.properties)) {
    const o: Record<string, Json> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) o[k] = exampleFor(doc, v, stack);
    if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') o.key = exampleFor(doc, schema.additionalProperties, stack);
    return o;
  }
  if (t === 'array') return [exampleFor(doc, schema.items, stack)];
  if (t === 'integer') return 0;
  if (t === 'number') return 0;
  if (t === 'boolean') return false;
  if (t === 'string') {
    if (schema.format === 'date-time') return '2026-10-12T10:00:00+02:00';
    if (schema.format === 'date') return '2026-10-12';
    return 'string';
  }
  return null;
}

/** Example of a media type object (example, examples, or generated from schema). */
export function mediaExample(doc: OpenApiDoc, media: Json): Json {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  if (media.examples && typeof media.examples === 'object') {
    const first: Json = Object.values(media.examples)[0];
    const ex = resolveRef(doc, first);
    if (ex?.value !== undefined) return ex.value;
  }
  if (media.schema) return exampleFor(doc, media.schema);
  return undefined;
}

export function jsonMedia(content: Json): [string, Json] | null {
  if (!content) return null;
  const keys = Object.keys(content);
  const k = keys.find((x) => x.includes('json')) ?? keys[0];
  return k ? [k, content[k]] : null;
}

#!/usr/bin/env python3
"""Generate the standalone API reference (OneStock design system) from
pkg/api/openapi.json.

  python3 scripts/apidoc.py                 -> docs/api/index.html (full page)
  python3 scripts/apidoc.py --fragment out  -> page body only (for hosts that
                                               add their own document skeleton)
"""
import json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads((root / "pkg/api/openapi.json").read_text())

CSS = r"""
:root{
  /* OneStock tokens (neutral ramp, primary teal, status colours, chrome) */
  --primary:#24bdb0;--primary-hover:#50cac0;--primary-tint:rgba(36,189,176,.10);
  --chrome:#18244a;--chrome-text:rgba(255,255,255,.82);--chrome-muted:rgba(255,255,255,.55);
  --bg:#fafafa;--surface:#ffffff;--surface-alt:#f7f7f7;--border:#e5e5e5;
  --text:#333333;--text-2:#7f7f7f;--text-3:#b2b2b2;--heading:#263239;
  --blue:#2695f3;--blue-t:rgba(38,149,243,.10);--green:#43a047;--green-t:rgba(67,160,71,.10);
  --orange:#fd7e14;--orange-t:rgba(253,126,20,.10);--purple:#673ab7;--purple-t:rgba(103,58,183,.10);
  --red:#f44539;--red-t:rgba(244,69,57,.10);--code-bg:#f7f7f7;--code-text:#263239;
  --font:'Roboto','Helvetica Neue',Arial,sans-serif;
  --mono:ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;
  --r-s:3px;--r-m:5px;--r-l:12px;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#12192f;--surface:#1a2340;--surface-alt:#202a4a;--border:#2c3759;
  --text:#e6e8ee;--text-2:#a3abc2;--text-3:#6f7894;--heading:#ffffff;
  --code-bg:#121a33;--code-text:#d8e0f2;--primary-tint:rgba(36,189,176,.18);
  --blue-t:rgba(38,149,243,.2);--green-t:rgba(67,160,71,.22);--orange-t:rgba(253,126,20,.2);
  --purple-t:rgba(149,117,205,.25);--red-t:rgba(244,69,57,.22);--chrome:#0d142b;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#12192f;--surface:#1a2340;--surface-alt:#202a4a;--border:#2c3759;
  --text:#e6e8ee;--text-2:#a3abc2;--text-3:#6f7894;--heading:#ffffff;
  --code-bg:#121a33;--code-text:#d8e0f2;--primary-tint:rgba(36,189,176,.18);
  --blue-t:rgba(38,149,243,.2);--green-t:rgba(67,160,71,.22);--orange-t:rgba(253,126,20,.2);
  --purple-t:rgba(149,117,205,.25);--red-t:rgba(244,69,57,.22);--chrome:#0d142b;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:400 14px/1.5 var(--font)}
a{color:var(--primary)}
code,pre{font-family:var(--mono);font-size:12.5px}
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;height:48px;background:var(--chrome);color:#fff;display:flex;align-items:center;gap:12px;padding:0 16px}
.top .brand{font-weight:500;font-size:16px;letter-spacing:.01em}
.top .sep{width:1px;height:20px;background:rgba(255,255,255,.3)}
.top .product{color:var(--chrome-text)}
.top .ver{margin-left:auto;font-size:12px;color:var(--chrome-muted)}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:calc(100% - 48px)}
nav.side{background:var(--chrome);color:var(--chrome-text);padding:16px 12px 32px;position:sticky;top:48px;height:calc(100vh - 48px);overflow:auto}
nav.side input{width:100%;height:36px;border-radius:var(--r-m);border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;padding:0 10px;font:400 14px var(--font);margin-bottom:12px}
nav.side input::placeholder{color:var(--chrome-muted)}
nav.side input:focus{outline:1px solid rgba(255,255,255,.8)}
nav.side .group{margin:14px 0 4px;padding:0 8px;font-size:12px;color:var(--chrome-muted)}
nav.side a{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:var(--r-m);color:var(--chrome-text);text-decoration:none;font-size:13px;line-height:1.3}
nav.side a:hover{background:rgba(255,255,255,.06)}
nav.side a.active{background:var(--primary);color:#fff}
nav.side a .m{flex:none;width:46px;font:500 10px/1 var(--mono);text-align:center;padding:3px 0;border-radius:var(--r-l);background:rgba(255,255,255,.1)}
nav.side a span.p{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{padding:24px 32px 64px;min-width:0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-m);padding:24px;margin-bottom:16px;min-width:0}
h1{font-size:22px;font-weight:500;margin:0 0 4px;color:var(--heading);text-wrap:balance}
h2{font-size:20px;font-weight:500;margin:32px 0 12px;color:var(--heading)}
h3{font-size:16px;font-weight:500;margin:20px 0 8px;color:var(--heading)}
h4{font-size:14px;font-weight:500;margin:16px 0 6px;color:var(--text-2)}
.lead{color:var(--text-2);max-width:72ch}
.desc p{margin:0 0 8px;max-width:80ch}
.desc ul{margin:0 0 8px;padding-left:20px}
.desc code,td code,.inline{background:var(--code-bg);color:var(--code-text);padding:1px 5px;border-radius:var(--r-s)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.fact{border:1px solid var(--border);border-radius:var(--r-m);padding:12px 14px;background:var(--surface)}
.fact b{display:block;font-size:20px;font-weight:500;color:var(--heading);font-variant-numeric:tabular-nums}
.fact span{font-size:12px;color:var(--text-2)}
.op{scroll-margin-top:64px}
.op-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:4px;font:500 11px/1 var(--mono);padding:5px 9px;border-radius:var(--r-l)}
.GET{color:var(--blue);background:var(--blue-t)}
.POST{color:var(--green);background:var(--green-t)}
.PUT{color:var(--orange);background:var(--orange-t)}
.PATCH{color:var(--purple);background:var(--purple-t)}
.DELETE{color:var(--red);background:var(--red-t)}
nav.side a .m.GET{color:#8fc9ff}nav.side a .m.POST{color:#9fe0a3}nav.side a .m.PUT{color:#ffc08a}nav.side a .m.PATCH{color:#c9b1f0}nav.side a .m.DELETE{color:#ff9d96}
nav.side a.active .m{color:#fff;background:rgba(255,255,255,.2)}
.path{font:500 14px var(--mono);color:var(--heading);word-break:break-all}
.lock{font:500 11px/1 var(--font);color:var(--orange);background:var(--orange-t);padding:5px 9px;border-radius:var(--r-l)}
.public{font:500 11px/1 var(--font);color:var(--green);background:var(--green-t);padding:5px 9px;border-radius:var(--r-l)}
.summary{font-size:16px;font-weight:500;margin:10px 0 6px;color:var(--heading)}
.tbl{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r-m)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--text-2);background:var(--surface-alt);padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:top}
tr:last-child td{border-bottom:none}
td.name{font-family:var(--mono);font-size:12.5px;white-space:nowrap;color:var(--heading)}
td.type{font-family:var(--mono);font-size:12px;color:var(--purple);white-space:nowrap}
.req{color:var(--red);font-size:11px;margin-left:4px}
.muted{color:var(--text-2)}
.enum{font-size:12px;color:var(--text-2)}
pre{background:var(--code-bg);color:var(--code-text);border:1px solid var(--border);border-radius:var(--r-m);padding:14px;overflow:auto;max-height:420px;margin:0}
.codehead{display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px}
button.copy{height:28px;padding:0 10px;border-radius:var(--r-m);border:1px solid var(--border);background:var(--surface);color:var(--text);font:500 12px var(--font);cursor:pointer}
button.copy:hover{background:var(--surface-alt)}
button.copy:focus-visible,nav.side a:focus-visible{outline:1px solid var(--text)}
.resp{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border)}
.resp:last-child{border-bottom:none}
.code{font:500 12px var(--mono);padding:3px 8px;border-radius:var(--r-l);flex:none}
.c2{color:var(--green);background:var(--green-t)}.c4{color:var(--orange);background:var(--orange-t)}.c5{color:var(--red);background:var(--red-t)}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.schema{scroll-margin-top:64px}
.hidden{display:none!important}
@media (max-width:1100px){.cols{grid-template-columns:minmax(0,1fr)}}
@media (max-width:820px){.layout{grid-template-columns:minmax(0,1fr)}nav.side{position:static;height:auto;max-height:50vh}main{padding:16px 16px 48px}.card{padding:16px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
"""

JS = r"""
const spec = JSON.parse(document.getElementById('spec').textContent);
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function md(s) {
  if (!s) return '';
  const blocks = String(s).trim().split(/\n\s*\n/);
  return blocks.map((b) => {
    const inl = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) return '<ul>' + lines.map((l) => '<li>' + inl(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>';
    return '<p>' + inl(lines.join(' ')) + '</p>';
  }).join('');
}
const refName = (r) => r.split('/').pop();
function resolve(s) { let guard = 0; while (s && s.$ref && guard++ < 10) s = spec.components.schemas[refName(s.$ref)]; return s || {}; }
function typeOf(s) {
  if (!s) return 'any';
  if (s.$ref) return refName(s.$ref);
  if (s.allOf) return s.allOf.map(typeOf).join(' & ');
  if (s.type === 'array') return typeOf(s.items) + '[]';
  if (s.type === 'object' && s.additionalProperties && !s.properties) return 'map<string, ' + (s.additionalProperties === true ? 'any' : typeOf(s.additionalProperties)) + '>';
  let t = s.type || 'object';
  if (s.format) t += ' (' + s.format + ')';
  return t;
}
function props(s, depth = 0, seen = new Set()) {
  s = resolve(s);
  if (s.allOf) { const merged = { properties: {}, required: [] }; s.allOf.forEach((p) => { const r = resolve(p); Object.assign(merged.properties, r.properties || {}); merged.required.push(...(r.required || [])); }); s = merged; }
  if (s.type === 'array' && s.items) return props(s.items, depth, seen);
  const out = [];
  const req = new Set(s.required || []);
  for (const [name, p0] of Object.entries(s.properties || {})) {
    const p = p0.$ref ? Object.assign({}, resolve(p0), { description: p0.description || resolve(p0).description }) : p0;
    out.push({ name, depth, type: typeOf(p0), required: req.has(name), desc: p.description || '', enum: p.enum, def: p.default, ex: p.example });
    const child = p0.$ref ? refName(p0.$ref) : (p0.items && p0.items.$ref ? refName(p0.items.$ref) : null);
    if (depth < 2 && child && !seen.has(child)) { const ns = new Set(seen); ns.add(child); out.push(...props(spec.components.schemas[child], depth + 1, ns)); }
    else if (depth < 2 && p.type === 'object' && p.properties) out.push(...props(p, depth + 1, seen));
  }
  return out;
}
function propTable(s) {
  const rows = props(s);
  if (!rows.length) return '<p class="muted">' + esc(typeOf(s)) + '</p>';
  return '<div class="tbl"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>' + rows.map((r) =>
    '<tr><td class="name" style="padding-left:' + (12 + r.depth * 18) + 'px">' + (r.depth ? '<span class="muted">└ </span>' : '') + esc(r.name) + (r.required ? '<span class="req">required</span>' : '') +
    '</td><td class="type">' + esc(r.type) + '</td><td>' + md(r.desc) +
    (r.enum ? '<div class="enum">One of: ' + r.enum.map((e) => '<code>' + esc(e) + '</code>').join(' ') + '</div>' : '') +
    (r.def !== undefined ? '<div class="enum">Default: <code>' + esc(JSON.stringify(r.def)) + '</code></div>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
}
function sample(s, depth = 0) {
  if (!s) return null;
  if (s.example !== undefined) return s.example;
  if (s.$ref) { if (depth > 3) return {}; return sample(spec.components.schemas[refName(s.$ref)], depth + 1); }
  if (s.allOf) return Object.assign({}, ...s.allOf.map((p) => sample(p, depth + 1)));
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'array': return depth > 3 ? [] : [sample(s.items, depth + 1)];
    case 'integer': return s.minimum ?? 0;
    case 'number': return 0;
    case 'boolean': return true;
    case 'string': return s.format === 'date-time' ? '2026-10-12T10:00:00+02:00' : s.format === 'date' ? '2026-10-12' : 'string';
    default: {
      if (depth > 3) return {};
      const o = {};
      for (const [k, v] of Object.entries(s.properties || {})) o[k] = sample(v, depth + 1);
      return o;
    }
  }
}
function copyBtn(text) { const id = 'c' + Math.random().toString(36).slice(2); window.__copy = window.__copy || {}; window.__copy[id] = text; return '<button class="copy" data-copy="' + id + '">Copy</button>'; }
document.addEventListener('click', (e) => {
  const b = e.target.closest('button.copy'); if (!b) return;
  const text = window.__copy[b.dataset.copy];
  const done = () => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { const pre = b.parentElement.nextElementSibling; const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); });
});

const methods = ['get', 'post', 'put', 'patch', 'delete'];
const ops = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const m of methods) if (item[m]) ops.push({ path, method: m.toUpperCase(), op: item[m], params: [...(item.parameters || []), ...(item[m].parameters || [])] });
}
const tags = spec.tags.map((t) => t.name);
const base = (spec.servers && spec.servers[0].url) || '/api/v1';
const opId = (o) => o.op.operationId || (o.method + o.path).replace(/\W+/g, '-');

// navigation
const nav = $('#nav');
nav.innerHTML = '<input id="q" type="search" placeholder="Filter endpoints" aria-label="Filter endpoints">' +
  '<a href="#overview">Overview</a>' +
  tags.map((t) => '<div class="group">' + esc(t) + '</div>' + ops.filter((o) => (o.op.tags || [])[0] === t).map((o) =>
    '<a href="#' + opId(o) + '" data-search="' + esc((o.method + ' ' + o.path + ' ' + (o.op.summary || '')).toLowerCase()) + '"><span class="m ' + o.method + '">' + o.method + '</span><span class="p">' + esc(o.op.summary || o.path) + '</span></a>').join('')).join('') +
  '<div class="group">Reference</div><a href="#schemas">Schemas</a>';
$('#q').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  nav.querySelectorAll('a[data-search]').forEach((a) => a.classList.toggle('hidden', q && !a.dataset.search.includes(q)));
  document.querySelectorAll('.op').forEach((el) => el.classList.toggle('hidden', q && !el.dataset.search.includes(q)));
});

// content
const counts = { ops: ops.length, paths: Object.keys(spec.paths).length, schemas: Object.keys(spec.components.schemas).length, admin: ops.filter((o) => o.op.security).length };
let html = '<section id="overview" class="card"><h1>' + esc(spec.info.title) + '</h1><p class="lead">' + esc(spec.info.summary || '') + '</p>' +
  '<div class="desc">' + md(spec.info.description) + '</div>' +
  '<div class="facts"><div class="fact"><b>' + counts.ops + '</b><span>Operations</span></div><div class="fact"><b>' + counts.paths + '</b><span>Paths</span></div>' +
  '<div class="fact"><b>' + counts.admin + '</b><span>Operations requiring the admin token</span></div><div class="fact"><b>' + counts.schemas + '</b><span>Schemas</span></div></div></section>';
for (const t of tags) {
  const tagOps = ops.filter((o) => (o.op.tags || [])[0] === t);
  if (!tagOps.length) continue;
  const td = spec.tags.find((x) => x.name === t);
  html += '<h2>' + esc(t) + '</h2>' + (td && td.description ? '<p class="lead">' + esc(td.description) + '</p>' : '');
  for (const o of tagOps) {
    const id = opId(o);
    const url = base + o.path;
    const secured = !!o.op.security;
    const body = o.op.requestBody && o.op.requestBody.content;
    const ctype = body ? Object.keys(body)[0] : null;
    const bodySchema = body ? body[ctype].schema : null;
    const example = body ? (body[ctype].example !== undefined ? body[ctype].example : sample(bodySchema)) : null;
    let curl = 'curl -X ' + o.method + " 'https://<host>" + url + "'";
    if (secured) curl += " \\\n  -H 'Authorization: Bearer $ADMIN_TOKEN'";
    if (body) curl += " \\\n  -H 'Content-Type: " + ctype + "' \\\n  --data '" + (typeof example === 'string' ? example : JSON.stringify(example)) + "'";
    html += '<section class="card op" id="' + id + '" data-search="' + esc((o.method + ' ' + o.path + ' ' + (o.op.summary || '')).toLowerCase()) + '">' +
      '<div class="op-head"><span class="badge ' + o.method + '">' + o.method + '</span><span class="path">' + esc(url) + '</span>' +
      (secured ? '<span class="lock">Admin token</span>' : '<span class="public">Public</span>') + '</div>' +
      '<div class="summary">' + esc(o.op.summary || '') + '</div><div class="desc">' + md(o.op.description) + '</div>';
    html += '<div class="cols"><div>';
    if (o.params.length) {
      html += '<h4>Parameters</h4><div class="tbl"><table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th></tr></thead><tbody>' + o.params.map((p0) => {
        const p = p0.$ref ? spec.components.parameters[refName(p0.$ref)] : p0;
        return '<tr><td class="name">' + esc(p.name) + (p.required ? '<span class="req">required</span>' : '') + '</td><td>' + esc(p.in) + '</td><td class="type">' + esc(typeOf(p.schema)) + '</td><td>' + md(p.description || '') +
          (p.schema && p.schema.default !== undefined ? '<div class="enum">Default: <code>' + esc(JSON.stringify(p.schema.default)) + '</code></div>' : '') +
          (p.schema && p.schema.enum ? '<div class="enum">One of: ' + p.schema.enum.map((e) => '<code>' + esc(e) + '</code>').join(' ') + '</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    if (body) html += '<h4>Request body <span class="muted">(' + esc(ctype) + ')</span></h4>' + (ctype.startsWith('text/') ? '<p class="muted">' + esc(bodySchema.type || 'string') + '</p>' : propTable(bodySchema));
    html += '<h4>Responses</h4>' + Object.entries(o.op.responses || {}).map(([code, r0]) => {
      const r = r0.$ref ? spec.components.responses[refName(r0.$ref)] : r0;
      const c = r.content ? Object.values(r.content)[0] : null;
      return '<div class="resp"><span class="code c' + code[0] + '">' + esc(code) + '</span><span>' + esc(r.description || '') + (c && c.schema ? ' <code class="inline">' + esc(typeOf(c.schema)) + '</code>' : '') + '</span></div>';
    }).join('');
    html += '</div><div>';
    html += '<div class="codehead"><h4 style="margin:0">Request</h4>' + copyBtn(curl) + '</div><pre>' + esc(curl) + '</pre>';
    if (body && !ctype.startsWith('text/')) { const ex = JSON.stringify(example, null, 2); html += '<div class="codehead"><h4 style="margin:0">Body example</h4>' + copyBtn(ex) + '</div><pre>' + esc(ex) + '</pre>'; }
    const ok = Object.entries(o.op.responses || {}).find(([c]) => c.startsWith('2'));
    if (ok) {
      const r = ok[1].$ref ? spec.components.responses[refName(ok[1].$ref)] : ok[1];
      const c = r.content ? Object.values(r.content)[0] : null;
      if (c && c.schema) { const ex = JSON.stringify(c.example !== undefined ? c.example : sample(c.schema), null, 2); html += '<div class="codehead"><h4 style="margin:0">Response ' + esc(ok[0]) + '</h4></div><pre>' + esc(ex) + '</pre>'; }
    }
    html += '</div></div></section>';
  }
}
html += '<h2 id="schemas">Schemas</h2>';
for (const [name, s] of Object.entries(spec.components.schemas)) {
  if (name.endsWith('Page')) continue;
  html += '<section class="card schema" id="schema-' + esc(name) + '"><h3 style="margin-top:0">' + esc(name) + '</h3>' + (s.description ? '<div class="desc">' + md(s.description) + '</div>' : '') +
    (s.enum ? '<p>One of: ' + s.enum.map((e) => '<code class="inline">' + esc(e) + '</code>').join(' ') + '</p>' : propTable(s)) + '</section>';
}
$('#content').innerHTML = html;

// active link while scrolling
const links = [...nav.querySelectorAll('a[href^="#"]')];
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); } });
}, { rootMargin: '-60px 0px -70% 0px' });
document.querySelectorAll('section[id]').forEach((s) => io.observe(s));
"""

def body():
    return (
        '<header class="top"><span class="brand">OneStock</span><span class="sep"></span><span class="product">Delivery Promise API</span>'
        f'<span class="ver">OpenAPI {spec["openapi"]} · v{spec["info"]["version"]}</span></header>'
        '<div class="layout"><nav class="side" id="nav" aria-label="Endpoints"></nav><main id="content"></main></div>'
        '<script type="application/json" id="spec">' + json.dumps(spec, ensure_ascii=False).replace("</", "<\\/") + '</script>'
        f'<script>{JS}</script>'
    )

head_links = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">'

if len(sys.argv) > 2 and sys.argv[1] == "--fragment":
    out = pathlib.Path(sys.argv[2])
    out.write_text(f"<title>Delivery Promise API</title>{head_links}<style>{CSS}</style>" + body())
    print(f"wrote {out}")
else:
    out = root / "docs/api/index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                   f'<title>Delivery Promise API</title>{head_links}<style>{CSS}</style></head><body>' + body() + '</body></html>\n')
    print(f"wrote {out.relative_to(root)}")

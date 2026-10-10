// k6 load test of POST /api/v1/delivery-promises.
//
// Environment:
//   BASE_URL      target (default http://localhost:8080)
//   NAME          scenario name, used for the result file
//   VUS           virtual users (closed model) or max VUs (open model)
//   DURATION      e.g. 30s
//   RATE          > 0 switches to constant-arrival-rate (requests/s)
//   BASKET_FILE   basket pool JSON (from /api/v1/benchmarks/baskets), shared
//                 by all VUs without copies (bench/run.sh downloads it)
//   OUT           JSON summary path (default results/<NAME>.json)
//
// Every iteration sends a different basket from a pool generated once by
// the server from the real stock (no replay of a single cached request).
// Failed and slow requests are kept in every statistic.
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const NAME = __ENV.NAME || 'promise';
const VUS = parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '30s';
const RATE = parseInt(__ENV.RATE || '0', 10);

const engineTime = new Trend('engine_calculation_ms', true);
const optionsCount = new Trend('options_per_response');
const noOption = new Rate('responses_without_option');
const byCategory = {
  mono: new Trend('latency_mono', true),
  multi: new Trend('latency_multi', true),
  'multi-source': new Trend('latency_multi_source', true),
  consolidation: new Trend('latency_consolidation', true),
};
const consolidated = new Counter('consolidated_options');

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    'http_req_duration{expected_response:true}': [{ threshold: 'p(95)<100', abortOnFail: false }],
    http_req_failed: ['rate<0.01'],
  },
  scenarios: RATE > 0
    ? {
        constant_rate: {
          executor: 'constant-arrival-rate',
          rate: RATE,
          timeUnit: '1s',
          duration: DURATION,
          preAllocatedVUs: Math.min(VUS, RATE),
          maxVUs: VUS,
        },
      }
    : {
        closed: { executor: 'constant-vus', vus: VUS, duration: DURATION },
      },
};

// The basket pool is loaded once and shared read-only by every VU.
const pool = new SharedArray('baskets', () => {
  const raw = JSON.parse(open(__ENV.BASKET_FILE || '../results/baskets.json'));
  return raw.map((b) => ({ body: JSON.stringify(b.request), cat: b.category }));
});

const calcRe = /"calculationTimeMs":([0-9.]+)/;

export default function () {
  // global iteration counter: every request uses the next basket
  const b = pool[exec.scenario.iterationInTest % pool.length];
  const res = http.post(`${BASE_URL}/api/v1/delivery-promises`, b.body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
    tags: { name: 'delivery-promises' },
  });
  const ok = check(res, { 'status is 200': (r) => r.status === 200 });
  byCategory[b.cat].add(res.timings.duration);
  if (ok && res.body) {
    // light parsing: the load generator must not become the bottleneck
    const m = calcRe.exec(res.body);
    if (m) engineTime.add(parseFloat(m[1]));
    const n = res.body.split('"deliveryMode":').length - 1;
    optionsCount.add(n);
    noOption.add(n === 0);
    if (res.body.indexOf('"strategy":"CONSOLIDATED"') >= 0) consolidated.add(1);
  }
}

export function handleSummary(data) {
  const out = __ENV.OUT || `results/${NAME}.json`;
  const m = data.metrics;
  const d = m.http_req_duration.values;
  const line = `${NAME}: reqs=${m.http_reqs.values.count} rps=${m.http_reqs.values.rate.toFixed(1)} ` +
    `p50=${d.med.toFixed(2)}ms p95=${d['p(95)'].toFixed(2)}ms p99=${d['p(99)'].toFixed(2)}ms max=${d.max.toFixed(2)}ms ` +
    `failed=${(m.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  const meta = { name: NAME, vus: VUS, duration: DURATION, rate: RATE, baseUrl: BASE_URL, baskets: pool.length };
  return { [out]: JSON.stringify({ meta, metrics: m, state: data.state }, null, 1), stdout: line };
}

export type RevenueTotals = { currency: string; pending: string; approved: string; settled: string };
export type RevenueSnapshot = {
  connected: boolean; month: string; generatedAt: string | null; totals: RevenueTotals[];
};
type Period = { start: string; end: string };
type ImpactConfig = { accountSid: string; authToken: string; campaignIds: string[] };
const DAY = 86_400_000;

export function revenuePeriod(month: string, now = new Date()): Period {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('INVALID_MONTH');
  const start = new Date(`${month}-01T00:00:00Z`);
  const offset = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  if (offset < 0 || offset > 2) throw new Error('INVALID_MONTH');
  const next = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return { start: start.toISOString(), end: new Date(Math.min(next - 1, now.getTime())).toISOString() };
}

// Impact decimal strings retain up to six places; do not sum money using floating point.
function decimal(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?\d{1,15}(\.\d{1,6})?$/.test(value)) throw new Error('IMPACT_INVALID_AMOUNT');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) * (value.startsWith('-') ? -1n : 1n);
}
function decimalString(value: bigint): string {
  const absolute = value < 0 ? -value : value;
  const fraction = String(absolute % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `${value < 0 ? '-' : ''}${absolute / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('IMPACT_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('IMPACT_INVALID_DATE');
  return Date.parse(value);
}

export function summarizeActions(actions: unknown[], campaignIds: string[], period: Period, now = new Date()): RevenueTotals[] {
  const totals = new Map<string, { pending: bigint; approved: bigint; settled: bigint }>();
  for (const raw of actions) {
    const row = record(raw);
    if (!campaignIds.includes(String(row.CampaignId))) continue;
    const eventDate = timestamp(row.EventDate);
    if (eventDate < Date.parse(period.start) || eventDate > Date.parse(period.end)) continue;
    if (!['PENDING', 'APPROVED', 'REVERSED'].includes(String(row.State))) throw new Error('IMPACT_INVALID_STATE');
    if (row.State === 'REVERSED') continue;
    if (typeof row.Currency !== 'string' || !/^[A-Z]{3}$/.test(row.Currency)) throw new Error('IMPACT_INVALID_CURRENCY');
    const amount = decimal(row.Payout);
    const cleared = row.ClearedDate != null && row.ClearedDate !== '';
    if (cleared && (timestamp(row.ClearedDate) > now.getTime() || row.State !== 'APPROVED')) throw new Error('IMPACT_INVALID_DATE');
    const bucket = row.State === 'PENDING' ? 'pending' : cleared ? 'settled' : 'approved';
    const total = totals.get(row.Currency) ?? { pending: 0n, approved: 0n, settled: 0n };
    total[bucket] += amount;
    totals.set(row.Currency, total);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => ({
    currency, pending: decimalString(values.pending), approved: decimalString(values.approved), settled: decimalString(values.settled),
  }));
}

export async function loadImpactRevenue(config: ImpactConfig, month: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<RevenueSnapshot> {
  const period = revenuePeriod(month, now);
  if (!/^[a-zA-Z0-9]+$/.test(config.accountSid) || !config.authToken || !config.campaignIds.length || config.campaignIds.length > 10 || config.campaignIds.some((id) => !/^\d+$/.test(id))) throw new Error('IMPACT_NOT_CONFIGURED');
  const actions = new Map<string, Record<string, unknown>>();
  // LastUpdated filters default to seven days. Cover purchase month through now in <=45-day windows.
  for (let from = Date.parse(period.start); from <= now.getTime(); from += 44 * DAY) {
    for (const campaignId of config.campaignIds) {
      const windowIds = new Set<string>();
      let expectedTotal: number | undefined;
      for (let page = 1; page <= 20; page++) {
        const url = new URL(`https://api.impact.com/Mediapartners/${config.accountSid}/Actions`);
        url.search = new URLSearchParams({ CampaignId: campaignId, ActionDateStart: period.start, ActionDateEnd: period.end,
          StartDate: new Date(from).toISOString(), EndDate: new Date(Math.min(from + 44 * DAY, now.getTime())).toISOString(), Page: String(page), PageSize: '1000' }).toString();
        const response = await fetcher(url, { headers: { Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`, Accept: 'application/json', 'IR-Version': '16' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('IMPACT_UNAVAILABLE');
        const data = record(await response.json());
        if (!Array.isArray(data.Actions)) throw new Error('IMPACT_INVALID_RESPONSE');
        const total = Number(data['@total']);
        if (Number(data['@page']) !== page || !Number.isSafeInteger(total) || total < 0 || (expectedTotal !== undefined && total !== expectedTotal)) throw new Error('IMPACT_INCOMPLETE');
        expectedTotal = total;
        for (const raw of data.Actions) {
          const row = record(raw);
          if (typeof row.Id !== 'string' || !row.Id) throw new Error('IMPACT_INVALID_RESPONSE');
          windowIds.add(`${row.CampaignId}:${row.Id}`);
          actions.set(`${row.CampaignId}:${row.Id}`, row);
        }
        const pages = Number(data['@numpages']);
        if (!Number.isInteger(pages) || pages < 0 || pages > 20 || (pages === 0 && data.Actions.length)) throw new Error('IMPACT_INCOMPLETE');
        if (page >= pages) {
          if (windowIds.size !== expectedTotal) throw new Error('IMPACT_INCOMPLETE');
          break;
        }
      }
    }
  }
  return { connected: true, month, generatedAt: now.toISOString(), totals: summarizeActions([...actions.values()], config.campaignIds, period, now) };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function handleRevenueRequest(request: Request, dependencies: {
  getUser: (authorization: string) => Promise<{ app_metadata?: { role?: string } } | null>;
  audit: (authorization: string) => Promise<void>;
  load: (month: string) => Promise<unknown>;
}): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'AUTH_REQUIRED' }, 401);
  try {
    const user = await dependencies.getUser(authorization);
    if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);
    if (user.app_metadata?.role !== 'admin') return json({ error: 'ADMIN_REQUIRED' }, 403);
    let month: string;
    try {
      const body = await request.text();
      if (body.length > 256) throw new Error();
      const parsed = JSON.parse(body);
      if (typeof parsed?.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(parsed.month)) throw new Error();
      month = parsed.month;
    } catch { return json({ error: 'INVALID_MONTH' }, 400); }
    // The existing RPC checks admin status again and attributes every read to auth.uid().
    try { await dependencies.audit(authorization); } catch { return json({ error: 'AUDIT_UNAVAILABLE' }, 503); }
    return json(await dependencies.load(month));
  } catch (error) {
    return error instanceof Error && error.message === 'INVALID_MONTH'
      ? json({ error: 'INVALID_MONTH' }, 400) : json({ error: 'REVENUE_UNAVAILABLE' }, 502);
  }
}

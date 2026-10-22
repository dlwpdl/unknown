import type { SupabaseClient } from '@supabase/supabase-js';
import type { RevenueSnapshot } from '../../supabase/functions/_shared/impact-revenue';

export type { RevenueSnapshot, RevenueTotals } from '../../supabase/functions/_shared/impact-revenue';

export function revenueMonths(now = new Date()) {
  return [0, 1, 2].map((offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7));
}

export async function loadTicketmasterRevenue(client: SupabaseClient, month: string): Promise<RevenueSnapshot> {
  const { data, error } = await client.functions.invoke('ticketmaster-revenue', { body: { month } });
  if (error || !data || typeof data.connected !== 'boolean' || data.month !== month || !Array.isArray(data.totals)) throw new Error('REVENUE_UNAVAILABLE');
  return data;
}

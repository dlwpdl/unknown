// @ts-nocheck -- Supabase Deno runtime.
/** Plain-text mail to the operator inbox through Resend (RESEND_API_KEY, ADMIN_ALERT_EMAIL). */
export async function sendAdminEmail(subject: string, text: string, from = 'gling <onboarding@resend.dev>') {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('ADMIN_ALERT_EMAIL');
  if (!apiKey || !to) throw new Error('ADMIN_EMAIL_NOT_CONFIGURED');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`ADMIN_EMAIL_${response.status}`);
}

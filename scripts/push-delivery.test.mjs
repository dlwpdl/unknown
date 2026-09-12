import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePushNotifications } from '../supabase/functions/_shared/push-notifications.ts';

const notificationId = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const job = { id: notificationId, lease_id: ticketId, token: 'ExpoPushToken[abcdefghijklmnop]', user_id: notificationId,
  notification_id: notificationId, category: 'messages', body: '새 메시지가 도착했어요.', route: '/chat?view=requests', ticket_id: null };
function harness({ sends = [job], receipts = [], fetcher = async () => Response.json({ data: [{ status: 'ok', id: ticketId }] }) } = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return { error: null, data: name === 'claim_push_notifications' ? args.p_phase === 'send' ? sends : receipts : null };
  };
  const run = (secret = 'test-secret') => handlePushNotifications(new Request('https://example.test', {
    method: 'POST', headers: { 'x-push-secret': secret },
  }), { secret: 'test-secret', rpc, fetcher, expoAccessToken: 'expo-access' });
  return { calls, run };
}
test('rejects unauthenticated workers before queue access', async () => {
  const h = harness();
  assert.equal((await h.run('wrong')).status, 401);
  assert.equal(h.calls.length, 0);
});
test('missing configuration and failed database writes cannot report success', async () => {
  const request = new Request('https://example.test', { method: 'POST', headers: { 'x-push-secret': 'secret' } });
  assert.equal((await handlePushNotifications(request, { rpc: () => { throw new Error('must not access queue'); } })).status, 503);
  const response = await handlePushNotifications(request, { secret: 'secret',
    rpc: async (name, args) => name === 'claim_push_notifications'
      ? { data: args.p_phase === 'send' ? [job] : [], error: null }
      : { data: null, error: 'private database details' },
    fetcher: async () => Response.json({ data: [{ status: 'ok', id: ticketId }] }),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'RESULT_SAVE_FAILED' });
});
test('sends only server claimed recipients and records a ticket, never actual delivery', async () => {
  const h = harness({ fetcher: async (url, options) => {
    assert.equal(url, 'https://exp.host/--/api/v2/push/send');
    assert.equal(options.headers.Authorization, 'Bearer expo-access');
    const [message] = JSON.parse(options.body);
    assert.equal(message.channelId, 'gling-activity');
    assert.deepEqual(message.data, { notificationId, userId: notificationId, category: 'messages', route: '/chat?view=requests' });
    assert.equal(message.body, job.body);
    return Response.json({ data: [{ status: 'ok', id: ticketId }] });
  } });
  assert.deepEqual(await (await h.run()).json(), { tickets: 1, providerAccepted: 0, retrying: 0, failed: 0 });
  assert.equal(h.calls.at(-1).args.p_result, 'ticket');
  assert.equal(h.calls.at(-1).args.p_ticket_id, ticketId);
});
test('temporary network and HTTP errors retry, permanent HTTP errors stop', async () => {
  for (const [fetcher, expected] of [
    [async () => { throw new Error('private token must not leak'); }, 'retry'],
    [async () => new Response('', { status: 429 }), 'retry'],
    [async () => new Response('', { status: 503 }), 'retry'],
    [async () => new Response('', { status: 400 }), 'failed'],
  ]) {
    const h = harness({ fetcher });
    const response = await h.run();
    assert.equal(h.calls.at(-1).args.p_result, expected);
    assert.doesNotMatch(await response.text(), /private token/);
  }
});
test('invalid tickets and provider response shapes cannot become accepted', async () => {
  for (const data of [null, {}, [], [{ status: 'ok' }], [{ status: 'ok', id: 'invalid' }], [{ status: 'ok', id: ticketId }, { status: 'ok', id: ticketId }]]) {
    const h = harness({ fetcher: async () => Response.json({ data }) });
    await h.run();
    assert.equal(h.calls.at(-1).args.p_result, 'retry');
  }
});
test('expired device tokens are disabled for ticket and receipt errors', async () => {
  const error = { status: 'error', details: { error: 'DeviceNotRegistered' }, message: job.token };
  for (const receipt of [false, true]) {
    const h = harness({ sends: receipt ? [] : [job], receipts: receipt ? [{ ...job, ticket_id: ticketId }] : [],
      fetcher: async () => Response.json({ data: receipt ? { [ticketId]: error } : [error] }) });
    await h.run();
    assert.equal(h.calls.find((call) => call.name === 'complete_push_notification').args.p_result, 'device_not_registered');
  }
});
test('receipts are polled without resending; only ok receipts mean provider accepted', async () => {
  for (const [data, expected] of [[{}, 'receipt_pending'], [{ [ticketId]: { status: 'ok' } }, 'provider_accepted'],
    [{ [ticketId]: { status: 'error', details: { error: 'MessageRateExceeded' } } }, 'retry']]) {
    const h = harness({ sends: [], receipts: [{ ...job, ticket_id: ticketId }], fetcher: async (url) => {
      assert.equal(url, 'https://exp.host/--/api/v2/push/getReceipts');
      return Response.json({ data });
    } });
    await h.run();
    assert.equal(h.calls.find((call) => call.name === 'complete_push_notification').args.p_result, expected);
  }
});
test('receipt fetch failure keeps its ticket instead of resending', async () => {
  const h = harness({ sends: [], receipts: [{ ...job, ticket_id: ticketId }], fetcher: async () => { throw new Error('network'); } });
  await h.run();
  assert.equal(h.calls.find((call) => call.name === 'complete_push_notification').args.p_result, 'receipt_pending');
});
test('external, admin and malformed routes fall back to notifications', async () => {
  for (const route of ['https://example.test', '/admin', '/post/not-a-uuid', '/chat?conversationId=../admin']) {
    const h = harness({ sends: [{ ...job, route }], fetcher: async (_, options) => {
      assert.equal(JSON.parse(options.body)[0].data.route, '/notifications');
      return Response.json({ data: [{ status: 'ok', id: ticketId }] });
    } });
    await h.run();
  }
});
test('request conversation routes retain their requests view', async () => {
  const route = `/chat?conversationId=${notificationId}&view=requests`;
  const h = harness({ sends: [{ ...job, route }], fetcher: async (_, options) => {
    assert.equal(JSON.parse(options.body)[0].data.route, route);
    return Response.json({ data: [{ status: 'ok', id: ticketId }] });
  } });
  const result = await (await h.run()).json();
  assert.equal(result.tickets, 1);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handlePushNotifications } from '../supabase/functions/_shared/push-notifications.ts';
import { notificationRoute } from '../src/lib/notification-preferences.ts';

const sql = readFileSync(new URL('../supabase/migrations/20261104232000_place_suggestions.sql', import.meta.url), 'utf8');
const fn = name => {
  const start = sql.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('end $$;', start));
};

test('only members suggest; only the service role lists and resolves', () => {
  for (const name of ['suggest_places(text,text[],text)', 'list_place_suggestions(text,integer)', 'resolve_place_suggestions(text,text,text,text,text)']) {
    assert.ok(sql.includes(`'public.${name}'`), name);
  }
  assert.match(sql, /execute 'revoke all on function '\|\|signature\|\|' from public,anon,authenticated,service_role'/);
  assert.match(sql, /grant execute on function public\.suggest_places\(text,text\[\],text\) to authenticated;/);
  assert.match(sql, /grant execute on function public\.list_place_suggestions\(text,integer\),public\.resolve_place_suggestions\(text,text,text,text,text\) to service_role;/);
  assert.equal((sql.match(/grant execute/g) ?? []).length, 2, 'no other grants');
  for (const name of ['list_place_suggestions', 'resolve_place_suggestions']) {
    assert.match(fn(name), /if auth\.role\(\) is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'/, name);
  }
  assert.match(sql, /alter table private\.place_suggestions enable row level security;/);
  assert.match(sql, /revoke all on private\.place_suggestions from public,anon,authenticated,service_role;/);
});

test('suggestions are bounded: 200 names a call, 120 characters a name, 20 calls a day', () => {
  const suggest = fn('suggest_places');
  assert.match(suggest, /if uid is null then raise exception 'AUTH_REQUIRED'; end if;\s+perform private\.assert_active_account\(uid\);/);
  assert.match(suggest, /cardinality\(p_names\)>200 then raise exception 'INVALID_PLACE_SUGGESTION'/);
  assert.match(suggest, /where char_length\(s\.n\) between 1 and 120 and s\.n !~ '\[\[:cntrl:\]\]'/);
  assert.match(suggest, /select distinct on \(lower\(s\.n\)\)/, 'duplicates collapse case-insensitively');
  assert.match(suggest, /on conflict \(user_id,city_id,lower\(name\)\) where status='pending' do nothing;/);
  assert.ok(suggest.indexOf("raise exception 'INVALID_PLACE_SUGGESTION'") < suggest.indexOf('enforce_rate_limit'), 'bad input spends no quota');
  assert.match(suggest, /perform private\.enforce_rate_limit\('place_suggestions', 20, interval '1 day'\);/);
  assert.match(sql, /name text not null check\(name=btrim\(name\) and char_length\(name\) between 1 and 120 and name !~ '\[\[:cntrl:\]\]'\)/);
  assert.match(sql, /create unique index place_suggestions_pending_once on private\.place_suggestions\(user_id,city_id,lower\(name\)\) where status='pending';/);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.ok(!/latitude|longitude|rating|photo/i.test(sql), 'only the name is accepted from Google');
});

test('the list never exposes who suggested a place', () => {
  const list = fn('list_place_suggestions');
  assert.match(list, /returns table\(name text,members integer,first_at timestamptz,last_at timestamptz\)/);
  const selected = list.slice(list.indexOf('return query select'), list.indexOf(' from private.place_suggestions'));
  assert.ok(!selected.includes('user_id') && !selected.includes(' id'), selected);
  assert.match(list, /group by lower\(s\.name\)/);
});

test('resolve saves only after the place key and place pass the existing saved checks', () => {
  const resolve = fn('resolve_place_suggestions');
  assert.match(resolve, /\(p_status='added'\)<>\(p_place_key is not null\)/);
  const order = ["perform private.saved_validate('place',p_place_key,p_city_id)", "v_card:=private.saved_card(private.saved_ref('place',p_place_key,p_city_id))",
    "if v_card is null then raise exception 'PLACE_UNAVAILABLE'", 'update private.place_suggestions set status=p_status',
    "perform public.set_saved_item('place',p_place_key,true,p_city_id)", 'perform private.create_notification('].map(text => resolve.indexOf(text));
  assert.ok(order.every(index => index >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(resolve, /continue when p_status<>'added' or not private\.is_active_account\(item\.user_id\);/);
  assert.match(resolve, /jsonb_build_object\('sub',item\.user_id,'role','authenticated'\)/, 'saves as the member through set_saved_item');
  assert.match(resolve, /perform set_config\('request\.jwt\.claims',coalesce\(claims,''\),true\);\s+continue when not saved/, 'service claims are back before the notification');
  assert.ok(!resolve.includes('insert into private.saved_places'), 'no second save path');
  assert.match(resolve, /create_notification\(item\.user_id,'place_suggestion_added',null,'place_suggestion',item\.id,v_body,v_route\)/);
  assert.match(resolve, /v_route:='\/places\/'\|\|p_place_key\|\|'\?cityId='\|\|p_city_id;/);
});

test('the new kind is in the kind and target constraints and the category map', () => {
  assert.match(sql, /replace\(definition,'CHECK \(','CHECK \(kind = ''place_suggestion_added'' or '\)/);
  assert.match(sql, /replace\(definition,'CHECK \(','CHECK \(target_type = ''place_suggestion'' or '\)/);
  assert.match(sql, /replace\(definition,'case p_kind','case p_kind when ''place_suggestion_added'' then ''system'''\)/);
  assert.match(sql, /notify pgrst,'reload schema';\s*$/);
});

test('the app and the push worker both open the suggested place', async () => {
  for (const route of ['/places/osm:node:652955238?cityId=vancouver', '/places/osm:way:1?cityId=toronto', '/places/partner:jimoco-coquitlam?cityId=vancouver']) {
    assert.equal(notificationRoute(route), route);
  }
  const bad = ['/places/osm:node:0123?cityId=vancouver', '/places/osm:node:1', '/places/osm:node:1?cityId=vancouver&next=/admin',
    '/places/osm:node:1?cityId=../admin', '/places/123%20Main%20St?cityId=vancouver', '/places/partner:Shop?cityId=vancouver'];
  for (const route of bad) assert.equal(notificationRoute(route), null, route);

  const id = '11111111-1111-4111-8111-111111111111';
  for (const [route, expected] of [['/places/osm:node:1?cityId=vancouver', '/places/osm:node:1?cityId=vancouver'], [bad[2], '/notifications']]) {
    let message;
    const job = { id, lease_id: id, token: 'ExpoPushToken[abcdefghijklmnop]', user_id: id, notification_id: id, ticket_id: null,
      kind: 'place_suggestion_added', category: 'system', body: '요청하신 ‘Cafe’, 글링 지도에 올리고 저장해 뒀어요.', route };
    const response = await handlePushNotifications(new Request('https://example.test', { method: 'POST', headers: { 'x-push-secret': 's' } }), {
      secret: 's', expoAccessToken: 'e',
      rpc: async (name, args) => ({ error: null, data: name === 'claim_push_notifications' && args.p_phase === 'send' ? [job] : [] }),
      fetcher: async (_, options) => { [message] = JSON.parse(options.body); return Response.json({ data: [{ status: 'ok', id }] }); },
    });
    assert.equal(response.status, 200);
    assert.equal(message.data.route, expected);
  }
});

test('the reply reads in English for members who use the app in English', async () => {
  const { englishNotificationBody } = await import('../src/lib/notification-copy.ts');
  assert.equal(englishNotificationBody({ kind: 'place_suggestion_added', body: '요청하신 ‘Cafe, Bar’, 글링 지도에 올리고 저장해 뒀어요.' }),
    '“Cafe, Bar”, the place you asked for, is on the gling map now. We saved it for you.');
  assert.match(readFileSync(new URL('../supabase/migrations/20261104232000_place_suggestions.sql', import.meta.url), 'utf8'), /'요청하신 ‘'\|\|\(v_card->>'title'\)\|\|'’, 글링 지도에 올리고 저장해 뒀어요\.'/);
});

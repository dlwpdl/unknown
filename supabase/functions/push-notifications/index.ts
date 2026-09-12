// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm: imports at deployment.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePushNotifications } from '../_shared/push-notifications.ts';

Deno.serve((request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handlePushNotifications(request, {
    secret: Deno.env.get('PUSH_NOTIFICATIONS_SECRET'),
    expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN'),
    rpc: (name, args) => supabase.rpc(name, args),
  });
});

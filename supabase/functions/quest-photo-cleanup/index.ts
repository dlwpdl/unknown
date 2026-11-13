// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm: imports at deployment.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleQuestPhotoCleanup } from '../_shared/quest-photo-cleanup.ts';

Deno.serve((request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handleQuestPhotoCleanup(request, {
    secret: Deno.env.get('PUSH_NOTIFICATIONS_SECRET'),
    rpc: (name, args) => supabase.rpc(name, args),
    remove: (paths) => supabase.storage.from('meetup-quest-photos').remove(paths),
  });
});

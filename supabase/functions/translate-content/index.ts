// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Supabase Edge resolves Deno npm specifiers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateContentTranslation, visibleTranslationSource } from '../_shared/content-translation.ts';
import { handleContentTranslation } from '../_shared/content-translation-handler.ts';

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // This key is confined to the server and never used to read the requested source.
  const cache = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (name, params) => {
    const { data, error } = await cache.rpc(name, params);
    if (error) throw new Error('TRANSLATION_CACHE_UNAVAILABLE');
    return data;
  };
  const cacheKey = (input) => ({
    p_kind: input.kind, p_content_id: input.id, p_language: input.language, p_source_hash: input.sourceHash,
  });
  return handleContentTranslation(request, {
    viewer: async () => {
      const { data: { user: viewer }, error } = await user.auth.getUser();
      if (error || !viewer) return null;
      const profile = await user.from('profiles').select('account_status,ai_safety_consent_at').eq('id', viewer.id).maybeSingle();
      if (profile.error || !profile.data) return null;
      return { id: viewer.id, active: profile.data.account_status === 'active', consented: !!profile.data.ai_safety_consent_at };
    },
    source: async (input) => {
      const query = input.kind === 'post'
        ? user.from('posts').select('title,body,room_preview').eq('id', input.id).eq('status', 'published')
        : user.from('comments').select('body').eq('id', input.id).is('deleted_at', null);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error('TRANSLATION_SOURCE_UNAVAILABLE');
      return data ? visibleTranslationSource(input.kind, data.title ?? null, data.body, !!data.room_preview) : null;
    },
    claim: (input) => rpc('claim_content_translation', { ...cacheKey(input), p_user_id: input.viewerId, p_characters: input.characters }),
    finish: (input, token, translation) => rpc('finish_content_translation', { ...cacheKey(input), p_token: token, p_translation: translation }),
    fail: (input, token) => rpc('fail_content_translation', { ...cacheKey(input), p_token: token }),
    generate: (source, language) => {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) throw new Error('TRANSLATION_NOT_CONFIGURED');
      return generateContentTranslation(source, language, apiKey);
    },
  });
});

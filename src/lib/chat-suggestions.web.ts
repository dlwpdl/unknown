import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatSuggestionContext } from './chat-suggestions';
export type { ChatSuggestionContext } from './chat-suggestions';

// The public participant web excludes app-only suggestion RPCs, as it does private review forms.
export function chatSuggestions(_context: ChatSuggestionContext | null, _isAuthor: boolean): string[] { return []; }
export async function loadChatSuggestionContext(_client: SupabaseClient, _conversationId: string): Promise<null> { return null; }
export async function sendSuggestedMessage(_client: SupabaseClient, _conversationId: string, _body: string, _clientId: string): Promise<string> { throw new Error('APP_REQUIRED'); }

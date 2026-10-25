// Client names come from open dynamic registration, so trust is decided by where the code is sent.
// Claude: support.claude.com 11503834 (claude.ai, future claude.com). ChatGPT: developers.openai.com/plugins/build/auth.
const trustedCallbacks: [host: string, path: RegExp][] = [
  ['claude.ai', /^\/api\/mcp\/auth_callback$/],
  ['claude.com', /^\/api\/mcp\/auth_callback$/],
  ['chatgpt.com', /^\/(connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/],
];
const loopback = ['127.0.0.1', 'localhost', '[::1]'];

export type McpClientTrust = { verified: boolean; host: string };

// A loopback callback only reaches the owner's own computer (Claude Code, Codex), never a remote party.
export function mcpClientTrust(redirectUri: string): McpClientTrust {
  let url: URL;
  try { url = new URL(redirectUri); } catch { return { verified: false, host: redirectUri }; }
  if (url.username || url.password) return { verified: false, host: url.host };
  if (url.protocol === 'http:' && loopback.includes(url.hostname)) return { verified: true, host: url.host };
  const verified = url.protocol === 'https:' && !url.port && trustedCallbacks.some(([host, path]) => url.hostname === host && path.test(url.pathname));
  return { verified, host: url.host };
}

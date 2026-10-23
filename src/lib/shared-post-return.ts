import { sharedPostReturnPath, SHARED_POST_RETURN_KEY } from './sharing.ts';

type ReturnStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
const key = SHARED_POST_RETURN_KEY + '.native';
const lifetime = 24 * 60 * 60 * 1000;
let tail: Promise<void> = Promise.resolve();

// Keep a matching clear's read/remove together so it cannot erase a newer intent.
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.then(() => {}, () => {});
  return result;
}
function canonical(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/post?')) return null;
  const safe = sharedPostReturnPath(path);
  return safe === '/' ? null : safe;
}
async function storedPath(storage: ReturnStorage): Promise<string | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  let record: unknown;
  try { record = JSON.parse(raw); } catch { /* Invalid local records are removed below. */ }
  if (record && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).length === 2
    && 'path' in record && 'savedAt' in record && typeof record.savedAt === 'number' && Number.isSafeInteger(record.savedAt)) {
    const path = canonical(record.path), age = Date.now() - record.savedAt;
    if (path && path === record.path && record.savedAt >= 0 && age >= 0 && age < lifetime) return path;
  }
  await storage.removeItem(key);
  return null;
}
function nativePath(path: string): string {
  return path.replace('/post?id=', '/post/').replace('&invite=1', '?invite=1');
}
export function rememberSharedPostReturn(storage: ReturnStorage, path: string): Promise<void> {
  return serialize(async () => {
    const safe = canonical(path);
    if (!safe) throw new Error('INVALID_SHARED_POST_RETURN');
    await storage.setItem(key, JSON.stringify({ path: safe, savedAt: Date.now() }));
  });
}
export function readSharedPostReturn(storage: ReturnStorage): Promise<string | null> {
  return serialize(async () => {
    const path = await storedPath(storage);
    return path ? nativePath(path) : null;
  });
}
export function clearSharedPostReturn(storage: ReturnStorage, path: string): Promise<void> {
  return serialize(async () => {
    const safe = canonical(path);
    if (!safe) throw new Error('INVALID_SHARED_POST_RETURN');
    if (await storedPath(storage) === safe) await storage.removeItem(key);
  });
}

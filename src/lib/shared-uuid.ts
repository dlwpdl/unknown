const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function encodeSharedUuid(id: string): string | null {
  if (id.length !== 36 || !uuid.test(id)) return null;
  const bytes = id.replace(/-/g, '').match(/../g)!.map(hex => String.fromCharCode(parseInt(hex, 16))).join('');
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSharedUuid(value: string): string | null {
  if (value.length !== 22 || !/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const hex = Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=='), char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return encodeSharedUuid(id) === value ? id : null;
}

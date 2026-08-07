const TOKEN_BYTES = 32;
const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length !== 64) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(value)) return null;
    bytes[i] = value;
  }
  return bytes;
}

export function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(token || '')));
  return bytesToHex(new Uint8Array(digest));
}

export async function tokenMatches(token, expectedHash) {
  const expected = hexToBytes(expectedHash);
  if (!expected) return false;
  const actual = hexToBytes(await hashToken(token));
  return crypto.subtle.timingSafeEqual(actual, expected);
}

export function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(value);
  return match ? match[1] : null;
}

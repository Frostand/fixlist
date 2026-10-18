/** A malformed shared URL must not abort app startup. URLSearchParams handles search decoding. */
export function decodeLocationHash(hash: string): string {
  try { return decodeURIComponent(hash.replace(/^#/, '')); }
  catch { return ''; }
}

export const DEMO_STORAGE_KEY = 'fixlist:demo:v1';
export const NAVIGATION_STORAGE_KEY = 'fixlist:navigation:v1';
/** One origin-local lock for household saves, recovery, reset and navigation drafts. */
export async function withDemoStorageLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(`${DEMO_STORAGE_KEY}:write`, { mode: 'exclusive' }, async () => operation()) : operation();
}

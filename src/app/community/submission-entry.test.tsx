import { createElement, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCommunity } from '../../community/storage';
import { createSeedState, saveCommunity } from '../../community';
import type { DemoAccountChoices } from './Onboarding';

const runtime = vi.hoisted(() => ({ authLoads: 0, choices: null as Parameters<typeof DemoAccountChoices>[0] | null }));
vi.mock('./AuthApp', () => {
  runtime.authLoads++;
  return { default: () => { throw new Error('Real auth must not initialize in submission.'); } };
});
vi.mock('./Onboarding', async original => {
  const actual = await original<typeof import('./Onboarding')>();
  return { ...actual, DemoAccountChoices(props: Parameters<typeof DemoAccountChoices>[0]) {
    runtime.choices = props;
    return createElement(actual.DemoAccountChoices, props);
  } };
});

const liveKey = 'fixlist:live:https%3A%2F%2Fcanary.supabase.co:auth';
let values: Map<string, string>, storage: Storage;
let reads: string[], writes: string[];
beforeEach(() => {
  runtime.choices = null; runtime.authLoads = 0;
  values = new Map([[liveKey, 'LIVE_SESSION_CANARY'], ['fixlist:live:profile-canary', 'LIVE_PROFILE_CANARY']]);
  reads = []; writes = [];
  storage = {
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(key, value) { writes.push(key); values.set(key, value); },
    removeItem(key) { writes.push(key); values.delete(key); },
    clear() { throw new Error('Submission must preserve live storage.'); },
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  saveCommunity(storage, createSeedState('2026-10-24T12:00:00.000Z'));
  reads = []; writes = [];
  vi.stubGlobal('window', { location: { hash: '' }, localStorage: storage });
  vi.stubEnv('MODE', 'submission');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://canary.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_canary_1234567890');
  vi.stubEnv('VITE_AUTH_GOOGLE_ENABLED', 'true');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function expectLiveUntouched() {
  expect(values.get(liveKey)).toBe('LIVE_SESSION_CANARY');
  expect(values.get('fixlist:live:profile-canary')).toBe('LIVE_PROFILE_CANARY');
  expect([...reads, ...writes].filter(key => key.startsWith('fixlist:live:'))).toEqual([]);
  expect(runtime.authLoads).toBe(0);
}

describe('submission entry and demo identities', () => {
  it('opens the actual local chooser with fictional labels and never imports auth despite inherited backend inputs', async () => {
    const { CommunityApp } = await import('./CommunityApp');
    const html = renderToStaticMarkup(createElement(CommunityApp));
    expect(html).toContain('Local demo mode');
    expect(html).toContain('Fictional accounts and activity on this device.');
    expect(html).toContain('Margaret Lee');
    expect(html).toContain('Jordan');
    expect(html).toContain('New elder demo');
    expect(html).toContain('New volunteer demo');
    expect(html).not.toMatch(/Continue with (Google|Apple|email)|Real account sign-in|type="(?:email|password)"|Loading FixList/);
    expect(runtime.choices!.groups.elder.some(account => account.id === 'elder-new-demo')).toBe(true);
    expect(runtime.choices!.groups.volunteer.some(account => account.id === 'volunteer-new-demo')).toBe(true);
    await new Promise(resolve => setImmediate(resolve));
    expectLiveUntouched();
  });

  it.each([
    ['elder-margaret', '/c/home'], ['volunteer-jordan', '/c/nearby'],
    ['elder-new-demo', '/c/setup/elder'], ['volunteer-new-demo', '/c/setup/volunteer'],
  ])('selects %s through the existing durable local identity path', async (id, route) => {
    const { CommunityApp } = await import('./CommunityApp');
    renderToStaticMarkup(createElement(CommunityApp));
    const before = loadCommunity(storage, '2026-10-24T12:00:00.000Z').state;
    runtime.choices!.onSelect(id);
    expect(window.location.hash).toBe(route);
    const after = loadCommunity(storage, '2026-10-24T12:00:00.000Z').state;
    expect(after.session.accountId).toBe(id);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.elders).toEqual(before.elders);
    expect(after.volunteers).toEqual(before.volunteers);
    if (id.endsWith('-new-demo')) expect(after.session.onboarded).not.toContain(id);
    else expect(after.session.onboarded).toContain(id);
    expectLiveUntouched();
  });

  it('keeps ordinary app modes behind the existing real-auth shell', async () => {
    vi.stubEnv('MODE', 'production');
    vi.resetModules();
    const { CommunityApp } = await import('./CommunityApp');
    const entry = CommunityApp();
    expect(entry.type).toBe(Suspense);
    expect(runtime.choices).toBeNull();
    expect(reads).toEqual([]); expect(writes).toEqual([]);
  });
});

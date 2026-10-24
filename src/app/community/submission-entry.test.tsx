import { createElement, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCommunity } from '../../community/storage';
import { COMMUNITY_STORAGE_KEY, createSeedState, saveCommunity, signIn, signOut } from '../../community';
import type { DemoAccountChoices, Intro } from './Onboarding';

const runtime = vi.hoisted(() => ({
  authLoads: 0,
  choices: null as Parameters<typeof DemoAccountChoices>[0] | null,
  intro: null as Parameters<typeof Intro>[0] | null,
}));
vi.mock('./AuthApp', () => {
  runtime.authLoads++;
  return { default: () => { throw new Error('Real auth must not initialize in submission.'); } };
});
vi.mock('./Onboarding', async original => {
  const actual = await original<typeof import('./Onboarding')>();
  return { ...actual,
    Intro(props: Parameters<typeof Intro>[0]) {
      runtime.intro = props;
      return createElement(actual.Intro, props);
    },
    DemoAccountChoices(props: Parameters<typeof DemoAccountChoices>[0]) {
      runtime.choices = props;
      return createElement(actual.DemoAccountChoices, props);
    },
  };
});

const liveKey = 'fixlist:live:https%3A%2F%2Fcanary.supabase.co:auth';
let values: Map<string, string>, storage: Storage;
let reads: string[], writes: string[];
const fetch = vi.fn(() => { throw new Error('Submission entry must stay local.'); });
beforeEach(() => {
  runtime.choices = null; runtime.intro = null; runtime.authLoads = 0; fetch.mockClear();
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
  let hash = '';
  const location = { get hash() { return hash; }, set hash(value: string) { hash = value && !value.startsWith('#') ? `#${value}` : value; } };
  vi.stubGlobal('window', { location, localStorage: storage });
  vi.stubGlobal('fetch', fetch);
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
  expect(fetch).not.toHaveBeenCalled();
}

describe('submission entry and demo identities', () => {
  it.each(['', '#/c/home', '#/c/intro'])('opens the existing Intro for a fresh submission at %s', async hash => {
    values.delete(COMMUNITY_STORAGE_KEY);
    window.location.hash = hash;
    const { CommunityApp } = await import('./CommunityApp');
    const html = renderToStaticMarkup(createElement(CommunityApp));
    expect(html).toContain('c-landing-nav');
    expect(html).toContain('A little help at home. A neighbor who cares.');
    expect(html).toContain('Get started');
    expect(html).toContain('I already have an account');
    expect(html).toContain('A local demo with fictional people and places.');
    expect(html).toContain('Local demo mode');
    expect(html).toContain('Fictional accounts and activity on this device.');
    expect(html).not.toMatch(/Continue with (Google|Apple|email)|Real account sign-in|type="(?:email|password)"|Loading FixList/);
    expect(runtime.choices).toBeNull();
    await new Promise(resolve => setImmediate(resolve));
    expectLiveUntouched();
  });

  it('returns a signed-out saved session to Intro without changing profiles', async () => {
    const selected = signIn(loadCommunity(storage, '2026-10-24T12:00:00.000Z').state, 'elder-margaret');
    if (!selected.ok) throw new Error(selected.message);
    const signedOut = signOut(selected.state);
    if (!signedOut.ok) throw new Error(signedOut.message);
    saveCommunity(storage, signedOut.state);
    const raw = values.get(COMMUNITY_STORAGE_KEY);
    window.location.hash = '#/c/intro';
    const { CommunityApp } = await import('./CommunityApp');
    expect(renderToStaticMarkup(createElement(CommunityApp))).toContain('c-landing-nav');
    expect(runtime.choices).toBeNull();
    expect(values.get(COMMUNITY_STORAGE_KEY)).toBe(raw);
    expectLiveUntouched();
  });

  it('opens the actual local chooser directly from Intro without importing auth despite inherited backend inputs', async () => {
    const { CommunityApp } = await import('./CommunityApp');
    renderToStaticMarkup(createElement(CommunityApp));
    runtime.intro!.onStart();
    expect(window.location.hash).toBe('#/c/signin');
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
    window.location.hash = '#/c/signin';
    renderToStaticMarkup(createElement(CommunityApp));
    const before = loadCommunity(storage, '2026-10-24T12:00:00.000Z').state;
    runtime.choices!.onSelect(id);
    expect(window.location.hash).toBe(`#${route}`);
    const after = loadCommunity(storage, '2026-10-24T12:00:00.000Z').state;
    expect(after.session.accountId).toBe(id);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.elders).toEqual(before.elders);
    expect(after.volunteers).toEqual(before.volunteers);
    if (id.endsWith('-new-demo')) expect(after.session.onboarded).not.toContain(id);
    else expect(after.session.onboarded).toContain(id);
    expectLiveUntouched();
  });

  it.each([
    ['elder-margaret', 'Hello, Margaret.', '#/c/home'],
    ['volunteer-jordan', 'A little help, close by.', '#/c/nearby'],
  ])('restores %s home and lets its wordmark revisit Intro without losing the saved account', async (id, greeting, home) => {
    const selected = signIn(loadCommunity(storage, '2026-10-24T12:00:00.000Z').state, id);
    if (!selected.ok) throw new Error(selected.message);
    saveCommunity(storage, selected.state);
    const raw = values.get(COMMUNITY_STORAGE_KEY);
    const { CommunityApp } = await import('./CommunityApp');
    const html = renderToStaticMarkup(createElement(CommunityApp));
    expect(html).toContain(greeting);
    expect(html).not.toContain('c-landing-nav');
    const wordmark = html.match(/class="c-wordmark" href="([^"]+)"/);
    expect(wordmark?.[1]).toBe('#/c/intro');
    window.location.hash = wordmark![1]!;
    expect(renderToStaticMarkup(createElement(CommunityApp))).toContain('c-landing-nav');
    runtime.intro!.onStart();
    expect(window.location.hash).toBe(home);
    expect(renderToStaticMarkup(createElement(CommunityApp))).toContain(greeting);
    expect(runtime.choices).toBeNull();
    expect(values.get(COMMUNITY_STORAGE_KEY)).toBe(raw);
    expectLiveUntouched();
  });

  it.each(['elder', 'volunteer'] as const)('keeps a returning blank %s in setup across landing and home routes', async role => {
    const id = `${role}-new-demo`, selected = signIn(loadCommunity(storage, '2026-10-24T12:00:00.000Z').state, id);
    if (!selected.ok) throw new Error(selected.message);
    saveCommunity(storage, selected.state);
    const raw = values.get(COMMUNITY_STORAGE_KEY);
    const { CommunityApp } = await import('./CommunityApp');
    for (const hash of ['', '#/c/intro', '#/c/signin', '#/c/home', '#/c/nearby']) {
      window.location.hash = hash;
      const html = renderToStaticMarkup(createElement(CommunityApp));
      expect(html).toContain('Let’s make this yours');
      expect(html).toContain('value=""');
      expect(html).not.toContain('c-landing-nav');
      expect(html).not.toContain('c-app-header');
      expect(runtime.choices).toBeNull();
      expect(values.get(COMMUNITY_STORAGE_KEY)).toBe(raw);
      expect(loadCommunity(storage, '2026-10-24T12:00:00.000Z').state.session.onboarded).not.toContain(id);
      expectLiveUntouched();
    }
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

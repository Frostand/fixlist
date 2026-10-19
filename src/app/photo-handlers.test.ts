import { describe, expect, it, vi } from 'vitest';
import type { PhotoStore } from '../lib/photo-storage';
import { addPhoto, removePhoto, type Dispatch } from './ui-controller';
const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
function store() { const blobs = new Map<string, Blob>(); const api: PhotoStore = { read: vi.fn(async (id) => blobs.get(id) ?? null), write: vi.fn(async (id, b) => { blobs.set(id, b); }), remove: vi.fn(async (id) => { blobs.delete(id); }), clear: vi.fn(async () => { blobs.clear(); }) }; return { blobs, api }; }
const encode = vi.fn(async () => ({ blob, width: 1600, height: 900 }));
describe('photo UI operations compensate both stores', () => {
  it('writes the re-encoded blob before requesting durable metadata', async () => { const s = store(), calls: string[] = []; const dispatch: Dispatch = async (c, requireSaved) => { expect(s.blobs.has('photo-one')).toBe(true); expect(requireSaved).toBe(true); calls.push(c.type); return { ok: true }; }; await addPhoto({ input: blob, id: 'photo-one', checklistItemId: 'rug-check', store: s.api, encode, dispatch }); expect(calls).toEqual(['add_photo']); });
  it('removes the new blob if metadata fails', async () => { const s = store(); await expect(addPhoto({ input: blob, id: 'photo-one', checklistItemId: 'rug-check', store: s.api, encode, dispatch: async () => ({ ok: false, code: 'permission_denied', error: 'denied' }) })).rejects.toThrow('denied'); expect(s.blobs.size).toBe(0); });
  it('never creates metadata when the blob write fails', async () => { const s = store(), dispatch = vi.fn(); s.api.write = vi.fn(async () => { throw Error('write failed'); }); await expect(addPhoto({ input: blob, id: 'photo-one', checklistItemId: 'rug-check', store: s.api, encode, dispatch })).rejects.toThrow('write failed'); expect(dispatch).not.toHaveBeenCalled(); });
  it('does not publish a photo after its screen unmounts or reset starts', async () => { const s = store(), dispatch = vi.fn(); let current = true; s.api.write = async (id, b) => { s.blobs.set(id, b); current = false; }; await expect(addPhoto({ input: blob, id: 'photo-one', checklistItemId: 'rug-check', store: s.api, encode, dispatch, isCurrent: () => current })).rejects.toThrow('photo-cancelled'); expect(s.blobs.size).toBe(0); expect(dispatch).not.toHaveBeenCalled(); });
  it('restores the original blob on a failed metadata removal', async () => { const s = store(); s.blobs.set('photo-one', blob); await expect(removePhoto({ id: 'photo-one', store: s.api, dispatch: async () => ({ ok: false, code: 'storage_unavailable', error: 'save failed' }) })).rejects.toThrow('save failed'); expect(s.blobs.get('photo-one')).toBe(blob); });
  it('retains metadata when blob removal fails', async () => { const s = store(), dispatch = vi.fn(); s.blobs.set('photo-one', blob); s.api.remove = async () => { throw Error('remove failed'); }; await expect(removePhoto({ id: 'photo-one', store: s.api, dispatch })).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled(); expect(s.blobs.has('photo-one')).toBe(true); });
  it('does not resurrect a photo cleared by reset while removal was in flight', async () => { const s = store(); s.blobs.set('photo-one', blob); await expect(removePhoto({ id: 'photo-one', store: s.api, metadataExists: () => false, dispatch: async () => ({ ok: false, code: 'cancelled', error: 'reset removed metadata' }) })).rejects.toThrow(); expect(s.blobs.size).toBe(0); });
  it('removes both records on a successful removal', async () => { const s = store(), dispatch = vi.fn(async () => ({ ok: true as const })); s.blobs.set('photo-one', blob); await removePhoto({ id: 'photo-one', store: s.api, dispatch }); expect(s.blobs.size).toBe(0); expect(dispatch).toHaveBeenCalledWith({ type: 'remove_photo', photoId: 'photo-one' }, true); });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ChangeEvent } from 'react';
import { I18nProvider } from '../i18n';
import { handlePhotoSelection, PhotoInputActions } from './Photos';
it.each(['en', 'es'] as const)('renders separate camera and existing-photo controls in %s', (language) => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { language, children: createElement(PhotoInputActions, { busy: false, onPhoto: vi.fn() }) }));
  expect(html.match(/type="file"/g)).toHaveLength(2); expect(html.match(/capture="environment"/g)).toHaveLength(1);
  expect(html).toContain(language === 'en' ? 'Take photo' : 'Tomar una foto'); expect(html).toContain(language === 'en' ? 'Choose existing photo' : 'Elegir una foto existente');
});
it('handles picker cancellation and same-file reselection through the shared callback', () => {
  const photo = new File([blob], 'photo.jpg'), onPhoto = vi.fn();
  const target = { files: [photo], value: 'photo.jpg' };
  handlePhotoSelection({ target } as unknown as ChangeEvent<HTMLInputElement>, onPhoto);
  expect(target.value).toBe(''); expect(onPhoto).toHaveBeenCalledWith(photo);
  handlePhotoSelection({ target: { files: [], value: '' } } as unknown as ChangeEvent<HTMLInputElement>, onPhoto);
  expect(onPhoto).toHaveBeenCalledOnce();
});

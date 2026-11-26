import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO } from '../community/request-photo.fixture';
import { requestPhoto } from '../community/request-photos';
import { photoDimensions, prepareRequestPhoto, stripJpegMetadata } from './request-photo';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function imageEnvironment(width = 4032, height = 3024, failure = false) {
  const drawImage = vi.fn(), fillRect = vi.fn(), toDataURL = vi.fn(() => PHOTO), revokeObjectURL = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, fillRect, fillStyle: '' }), toDataURL };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:temporary-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
  vi.stubGlobal('Image', class {
    naturalWidth = width; naturalHeight = height; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => { if (failure) this.onerror?.(); else this.onload?.(); }); }
  });
  return { canvas, drawImage, toDataURL, revokeObjectURL };
}
describe('request photo preparation', () => {
  it.each([[4032,3024,1024,768],[3000,6000,512,1024],[640,480,640,480],[1,10000,1,1024]])('scales %s × %s to %s × %s without upscaling', (w,h,width,height) => {
    expect(photoDimensions(w,h)).toEqual({ width, height });
  });
  it.each([[0,1],[1,0],[NaN,10],[Infinity,10]])('rejects invalid dimensions %s × %s', (w,h) => expect(() => photoDimensions(w,h)).toThrow());
  it('draws decoded pixels to a bounded canvas, encodes JPEG at 0.8 and releases the original URL', async () => {
    const h = imageEnvironment();
    expect(await prepareRequestPhoto(new File(['original EXIF GPS bytes'], 'private-name.heic'))).toBe(PHOTO);
    expect(h.canvas.width).toBe(1024); expect(h.canvas.height).toBe(768);
    expect(h.drawImage).toHaveBeenCalledWith(expect.anything(),0,0,1024,768);
    expect(h.toDataURL).toHaveBeenCalledWith('image/jpeg',0.8);
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:temporary-photo');
  });
  it('reduces pixels again when the first JPEG exceeds the stored bound', async () => {
    const h = imageEnvironment(); h.toDataURL.mockReturnValueOnce(`data:image/jpeg;base64,${'A'.repeat(500000)}`);
    await prepareRequestPhoto(new File([], 'photo.jpg'));
    expect(h.canvas.width).toBe(768); expect(h.canvas.height).toBe(576);
    expect(h.toDataURL).toHaveBeenCalledTimes(2);
  });
  it('removes the Exif block iOS adds to canvas JPEGs so the stored photo validates', async () => {
    // Insert an APP1 Exif segment (as ImageIO writes) and a comment right after SOI of the fixture.
    const raw = atob(PHOTO.slice(23)), exif = 'Exif\0\0MM\0*\0\0\0\x08', comment = 'GPS 33.0 N';
    const seg = (marker: number, body: string) => String.fromCharCode(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255) + body;
    const withMeta = `data:image/jpeg;base64,${btoa(raw.slice(0, 2) + seg(0xe1, exif) + seg(0xfe, comment) + raw.slice(2))}`;
    expect(requestPhoto(withMeta)).toBe(false);
    expect(stripJpegMetadata(withMeta)).toBe(PHOTO);
    const h = imageEnvironment(); h.toDataURL.mockReturnValue(withMeta);
    expect(await prepareRequestPhoto(new File([], 'IMG_0001.jpg'))).toBe(PHOTO);
    expect(h.toDataURL).toHaveBeenCalledOnce();
  });
  it('leaves non-JPEG or malformed data unchanged', () => {
    expect(stripJpegMetadata('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(stripJpegMetadata('data:image/jpeg;base64,!!')).toBe('data:image/jpeg;base64,!!');
    expect(stripJpegMetadata('data:image/jpeg;base64,/9j/4QAZ')).toBe('data:image/jpeg;base64,/9j/4QAZ');
  });
  it('rejects decode failures and still releases the original URL', async () => {
    const h = imageEnvironment(10,10,true);
    await expect(prepareRequestPhoto(new File([], 'bad.heic'))).rejects.toThrow('opened');
    expect(h.toDataURL).not.toHaveBeenCalled(); expect(h.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('rejects unavailable canvas and unusable encoder output', async () => {
    const h = imageEnvironment(); h.canvas.getContext = () => null as never;
    await expect(prepareRequestPhoto(new File([], 'photo.jpg'))).rejects.toThrow('unavailable');
    const next = imageEnvironment(); next.toDataURL.mockReturnValue('data:image/png;base64,AAAA');
    await expect(prepareRequestPhoto(new File([], 'photo.jpg'))).rejects.toThrow('prepared');
    expect(next.toDataURL).toHaveBeenCalledTimes(5);
  });
});

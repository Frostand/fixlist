// Minimal Chrome DevTools Protocol driver shared by the product-video scripts.
import { spawn } from 'node:child_process';

export const CHROME = process.env.CHROME_HEADLESS ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openChrome({ width, height, scale = 1, mobile = false, dark = false }) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless', '--hide-scrollbars', '--allow-file-access-from-files', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 100 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  if (!version) throw new Error('Chrome did not start.');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const close = () => { ws.close(); chrome.kill('SIGKILL'); };
  return { send, evaluate, close };
}

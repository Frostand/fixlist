import { Capacitor, registerPlugin } from '@capacitor/core';

/** iOS WKWebView ignores window.print(); the app registers a native plugin that opens the system print sheet. */
interface FixListPrintPlugin { print(options: { jobName: string }): Promise<{ completed: boolean }> }
const FixListPrint = registerPlugin<FixListPrintPlugin>('FixListPrint');

export async function printCurrentPage(jobName: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') await FixListPrint.print({ jobName });
  else window.print();
}

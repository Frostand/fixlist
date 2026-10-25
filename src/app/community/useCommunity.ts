import { useEffect, useState } from 'react';
import { currentAccount, saveCommunity } from '../../community';
import { COMMUNITY_STORAGE_KEY, createCommunityStore } from '../../community/storage';
import type { CommunityResult, CommunityState } from '../../community/types';
export function communityStorage(): Storage | null { try {
    return typeof window === 'undefined' ? null : window.localStorage;
}
catch {
    return null;
} }
export type CommunityCommand<T extends CommunityResult = CommunityResult> = (state: CommunityState) => T;
/** Legacy candidate/save pair; callers must check saved. Live controllers use createCommunityStore. */
export function applyCommunityCommand<T extends CommunityResult>(state: CommunityState, command: CommunityCommand<T>, storage: Storage | null): {
    result: T;
    saved: boolean;
} { const result = command(state); return { result, saved: result.ok ? saveCommunity(storage, result.state) : true }; }
export function useCommunity() {
    const [source] = useState(() => { const storage = communityStorage(); return { storage, store: createCommunityStore(storage) }; });
    const [, setVersion] = useState(0);
    const { storage, store } = source;
    useEffect(() => {
        const target = typeof window === 'undefined' ? null : window;
        const unsubscribe = store.subscribe(() => setVersion(version => version + 1));
        const sync = (event: StorageEvent) => {
            if ((event.key === COMMUNITY_STORAGE_KEY || event.key === null) && (!event.storageArea || event.storageArea === storage)) store.refresh();
        };
        target?.addEventListener('storage', sync);
        store.refresh();
        return () => { unsubscribe(); target?.removeEventListener('storage', sync); };
    }, [storage, store]);
    return { state: store.state, account: currentAccount(store.state), resetEpoch: store.resetEpoch, run: store.run, reset: store.reset, issue: store.issue, clearIssue: store.clearIssue, readScope: () => ({ state: store.state, resetEpoch: store.resetEpoch }) };
}
// Older injected UI facades need not implement persistence metadata. The live hook always returns a string epoch and a reset result.
export type CommunityController = Omit<ReturnType<typeof useCommunity>, 'resetEpoch' | 'reset' | 'readScope'> & { readScope?: ReturnType<typeof useCommunity>['readScope']; resetEpoch?: string; reset(): CommunityResult | void };

import { useRef, useState } from 'react';
import { currentAccount, loadCommunity, resetCommunity, saveCommunity } from '../../community';
import type { CommunityResult, CommunityState } from '../../community/types';
export function communityStorage(): Storage | null { try {
    return typeof window === 'undefined' ? null : window.localStorage;
}
catch {
    return null;
} }
export type CommunityCommand<T extends CommunityResult = CommunityResult> = (state: CommunityState) => T;
/** Commands remain pure; this is the single publication/persistence boundary. */
export function applyCommunityCommand<T extends CommunityResult>(state: CommunityState, command: CommunityCommand<T>, storage: Storage | null): {
    result: T;
    saved: boolean;
} { const result = command(state); return { result, saved: result.ok ? saveCommunity(storage, result.state) : true }; }
export function useCommunity() {
    const [loaded] = useState(() => loadCommunity(communityStorage(), new Date().toISOString()));
    const [state, setState] = useState(loaded.state), ref = useRef(state);
    ref.current = state;
    const [issue, setIssue] = useState<'command' | 'storage' | 'recovered' | null>(loaded.status === 'recovered' ? 'recovered' : null);
    function run<T extends CommunityResult>(command: CommunityCommand<T>): T { const { result, saved } = applyCommunityCommand(ref.current, command, communityStorage()); if (result.ok) {
        ref.current = result.state;
        setState(result.state);
        setIssue(saved ? null : 'storage');
    }
    else
        setIssue('command'); return result; }
    function reset() { const next = resetCommunity(communityStorage(), new Date().toISOString()); ref.current = next; setState(next); setIssue(saveCommunity(communityStorage(), next) ? null : 'storage'); }
    return { state, account: currentAccount(state), run, reset, issue, clearIssue: () => setIssue(null) };
}
export type CommunityController = ReturnType<typeof useCommunity>;

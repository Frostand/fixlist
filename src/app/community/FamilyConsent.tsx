import { useFamilyCopy } from '../../i18n/family';
import { useRef, useState } from 'react';
import { approveFamilyGrant, familyGrant, familyScopeFailure, LEGACY_FAMILY_SCOPES, revokeFamilyGrant } from '../../community/family';
import type { Account, CommunityState, FamilyGrant } from '../../community/types';
import type { CommunityCommand } from './useCommunity';
import { Button } from './UI';
export function FamilyConsent({ account, state, onCommand }: { account: Account; state: CommunityState; onCommand(command: CommunityCommand): boolean }) {
  const f = useFamilyCopy();
  const [familyId, setFamilyId] = useState(''), [edit, setEdit] = useState(false), [notice, setNotice] = useState('');
  const latest = useRef(state); latest.current = state;
  const active = () => latest.current.session === state.session && latest.current.session.accountId === account.id;
  const run = (command: CommunityCommand) => {
    if (!active()) return;
    const ok = onCommand(s => s.session === state.session ? command(s) : familyScopeFailure());
    setNotice(f(ok ? 'permissionSaved' : 'permissionFailed'));
  };
  function remove(grant: FamilyGrant) { run(s => revokeFamilyGrant(s, { actorId: account.id, elderId: grant.elderId, familyId: grant.familyId, revision: grant.revision }, new Date().toISOString())); }
  const grants = state.familyHistory?.grants.filter(g => g.revokedAt === null && (g.elderId === account.id || g.familyId === account.id)
    && familyGrant(state, g.familyId, g.elderId)?.revision === g.revision) ?? [];
  const expectedRevision = state.familyHistory?.grants.filter(g => g.elderId === account.id && g.familyId === familyId).at(-1)?.revision ?? null;
  return <section className="c-stack" lang={f.language} dir={f.dir}><h3>{f('permissions')}</h3><p>{f('permissionNotice')}</p>
    {grants.map(grant => <div className="c-family-permission" key={grant.revision}><strong>{state.accounts.find(a => a.id === (account.role === 'elder' ? grant.familyId : grant.elderId))?.name}</strong><p>{f('baseScopes')} {f(grant.scopes.includes('profile') ? 'profileScope' : 'noProfileScope')}</p>{grant.origin === 'fictional-demo' ? <p className="c-small">{f('fictionalConsent')}</p> : null}<Button kind="quiet" onClick={() => remove(grant)}>{f(account.role === 'family' ? 'remove' : 'revoke')}</Button></div>)}
    {account.role === 'elder' ? <form className="c-stack" onSubmit={event => { event.preventDefault(); if (!familyId) return; run(s => approveFamilyGrant(s, { elderId: account.id, familyId, scopes: [...LEGACY_FAMILY_SCOPES, ...(edit ? ['profile' as const] : [])], expectedRevision }, new Date().toISOString())); }}>
      <label className="c-field">{f('familyHelper')}<select required value={familyId} onChange={event => { if (active()) { setFamilyId(event.target.value); setEdit(false); setNotice(''); } }}><option value="">{f('chooseFamily')}</option>{state.accounts.filter(a => a.role === 'family').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <p>{f('approval')}</p>
      <label className="c-family-check"><input type="checkbox" checked={edit} onChange={event => { if (active()) setEdit(event.target.checked); }}/>{f('editConsent')}</label>
      <Button type="submit" disabled={!familyId}>{f('approve')}</Button>
    </form> : <p>{f('elderOnly')}</p>}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}

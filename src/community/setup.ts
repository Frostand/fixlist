import { isLanguage } from '../domain/roles';
import { completeOnboarding, createAccount } from './commands';
import { locationForArea } from './geo';
import * as valid from './validation';
import type { AccountRole, AvailabilitySlot, CommunityFailure, CommunityState, Language, SignInProvider, Skill, Tool } from './types';

export interface SetupValues {
  name: string;
  role: AccountRole;
  language: Language;
  area: string;
  needs: string[];
  skills: Skill[];
  tools: Tool[];
  availability: AvailabilitySlot[];
  maxMiles: number;
  school: string;
  elderId: string;
}

/** One candidate state for the durable store: no account/profile/completion is published separately. */
export function completeAccountSetup(state: CommunityState, accountId: string | null, input: SetupValues, provider: SignInProvider, now: string): { ok: true; state: CommunityState; accountId: string } | CommunityFailure {
  if (state.session.accountId !== accountId) return { ok: false, code: 'permission_denied', message: 'Choose your own demo profile first.' };
  const selected = state.accounts.find(a => a.id === accountId);
  if (accountId !== null && !selected) return { ok: false, code: 'not_found', message: 'Demo profile not found.' };
  if (!valid.shape(input, ['name', 'role', 'language', 'area', 'needs', 'skills', 'tools', 'availability', 'maxMiles', 'school', 'elderId'])
    || !valid.oneOf(input.role, ['elder', 'volunteer', 'family']) || !valid.text(input.name, 120) || !valid.text(input.area, 160)
    || !isLanguage(input.language) || !valid.oneOf(provider, ['apple', 'google', 'email']) || !valid.iso(now)
    || !valid.text(input.elderId, 100, true)) return { ok: false, code: 'invalid_input', message: 'Check the setup fields.' };
  if (selected && selected.role !== input.role) return { ok: false, code: 'permission_denied', message: 'Set up your selected role only.' };

  let candidate = state;
  if (accountId === null) {
    const created = createAccount(state, { role: input.role, name: input.name, area: input.area, language: input.language, provider }, now);
    if (!created.ok) return created;
    candidate = created.state;
    accountId = created.accountId;
  }
  const id = accountId, name = input.name.trim(), area = input.area.trim();
  candidate = { ...candidate, accounts: candidate.accounts.map(a => a.id === id
    ? { ...a, name, firstName: name.split(/\s+/u)[0]!, area, location: locationForArea(area), language: input.language } : a) };
  if (input.role === 'elder') {
    const profile = candidate.elders.find(e => e.accountId === id);
    if (!profile) return { ok: false, code: 'not_found', message: 'Elder profile not found.' };
    const next = { ...profile, needs: input.needs };
    if (!valid.elder(next)) return { ok: false, code: 'invalid_input', message: 'Check the selected needs.' };
    candidate = { ...candidate, elders: candidate.elders.map(e => e.accountId === id ? { ...next, needs: input.needs.map(n => n.trim()) } : e) };
  } else if (input.role === 'volunteer') {
    const profile = candidate.volunteers.find(v => v.accountId === id);
    if (!profile) return { ok: false, code: 'not_found', message: 'Volunteer profile not found.' };
    const next = { ...profile, skills: input.skills, tools: input.tools, availability: input.availability, maxMiles: input.maxMiles, school: input.school };
    if (!valid.volunteer(next)) return { ok: false, code: 'invalid_input', message: 'Check the skills, tools, distance and availability.' };
    candidate = { ...candidate, volunteers: candidate.volunteers.map(v => v.accountId === id ? structuredClone({ ...next, school: input.school.trim() }) : v) };
  }
  // The family picker is informational. Setup never grants or changes a family link.
  const completed = completeOnboarding(candidate, id);
  return completed.ok ? { ...completed, accountId: id } : completed;
}

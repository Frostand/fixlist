import type { ElderNextStep, VolunteerNextStep } from '../domain/role-views';
import type { DemoState, Person } from '../domain/workflow';
import type { MessageKey, Translator } from '../i18n';
import type { Route } from './routes';
export const guideIdFor = (person: Person): string => person.role === 'volunteer' ? 'volunteer-guide' : 'resident-guide';
export function guideProgress(person: Person) { return person.onboarding[guideIdFor(person)] ?? { stepIndex: 0, completed: false }; }
export function personLabel(people: readonly Pick<Person, 'id' | 'name' | 'role'>[], id: string, t: Translator, residentName = 'Margaret'): string {
  const p = people.find((person) => person.id === id);
  if (!p) return t('common.legacy');
  const role = t(`role.${p.role}`);
  return p.role === 'family_helper' ? `${p.name} (${role}) · ${t('person.acting', { name: residentName })}` : `${p.name} (${role.toLocaleLowerCase()})`;
}
export function nextStepCard(step: ElderNextStep | VolunteerNextStep | null, state: Pick<DemoState, 'people' | 'household'>, volunteer: boolean): { key: MessageKey; route: Route } {
  const root = volunteer ? 'v' : 'r';
  if (!step) return { key: 'next.helper', route: { role: 'r', screen: 'check' } };
  if (step.kind === 'done') return { key: 'next.done', route: volunteer ? { role: 'v', screen: 'tasks' } : { role: 'r', screen: 'plan' } };
  if ('requestId' in step) return { key: `next.${step.kind}`, route: root === 'v' ? { role: 'v', screen: 'task', id: step.requestId } : step.kind === 'find_professional' ? { role: 'r', screen: 'resources' } : { role: 'r', screen: 'request', id: step.requestId } };
  if (step.kind === 'answer_checklist') return { key: 'next.answer_checklist', route: { role: 'r', screen: 'question', id: step.checklistItemId } };
  if (step.kind === 'confirm_concern') return { key: 'next.confirm_concern', route: { role: 'r', screen: 'question', id: step.concernId.replace(/-concern$/, '-check') } };
  void state;
  return { key: 'next.create_request', route: { role: 'r', screen: 'plan' } };
}
export function domainErrorKey(error: string): { key: MessageKey; values?: Record<string, string> } {
  const known: Record<string, MessageKey> = {
    'Only the resident can approve this change.': 'error.resident', 'Only the invited volunteer can make this change.': 'error.volunteer',
    'This request changed. Refresh it before trying again.': 'error.stale', 'This request is inactive history. Confirm its plan action before updating it.': 'error.inactive',
    'Maple House already has its one resident. A new profile cannot take over the household.': 'person.oneResident',
    'Use a name of 1–40 characters; this demo supports up to 20 people.': 'error.profileName', 'photo-persistence': 'check.unsaved',
  };
  if (known[error]) return { key: known[error] };
  const scope = /must grant (checklist|confirm|requests) permission/.exec(error)?.[1];
  if (scope) return { key: 'error.permission', values: { scope } };
  return { key: 'error.generic' };
}

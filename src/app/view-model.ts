import type { ElderNextStep, HelperNextStep, VolunteerNextStep } from '../domain/role-views';
import { isIsoTimestamp, type HelpRequest } from '../domain/workflow';
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
export function nextStepCard(step: ElderNextStep | HelperNextStep | VolunteerNextStep | null, state: Pick<DemoState, 'people' | 'household'>, volunteer: boolean): { key: MessageKey; route: Route } {
  const root = volunteer ? 'v' : 'r';
  if (!step) return { key: 'next.helper', route: { role: 'r', screen: 'check' } };
  if (step.kind === 'helper_wait') return { key: 'next.helper_wait', route: { role: 'r', screen: 'request', id: step.requestId } };
  if (step.kind === 'helper_evidence' || step.kind === 'helper_access') return { key: `next.${step.kind}`, route: { role: 'r', screen: 'help' } };
  if (step.kind === 'done') return { key: 'next.done', route: volunteer ? { role: 'v', screen: 'tasks' } : { role: 'r', screen: 'plan' } };
  if ('requestId' in step) return { key: `next.${step.kind}`, route: root === 'v' ? { role: 'v', screen: 'task', id: step.requestId } : { role: 'r', screen: 'request', id: step.requestId } };
  if (step.kind === 'answer_checklist') return { key: 'next.answer_checklist', route: { role: 'r', screen: 'question', id: step.checklistItemId } };
  if (step.kind === 'confirm_concern') return { key: 'next.confirm_concern', route: { role: 'r', screen: 'question', id: step.concernId.replace(/-concern$/, '-check') } };
  void state;
  return { key: 'next.create_request', route: { role: 'r', screen: 'plan' } };
}
/** Validate dates before comparing; request ID and event position resolve equal times. */
export function latestUpdates(requests: readonly { request: Pick<HelpRequest, 'id' | 'updates'> }[], limit = 3) {
  return requests.flatMap(({ request }) => request.updates.map((update, index) => ({ ...update, requestId: request.id, index })))
    .filter((u) => isIsoTimestamp(u.at))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0) || b.index - a.index)
    .slice(0, limit);
}

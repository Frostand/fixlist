import { evaluateFactRule, type FactDefinition } from './fact-screening';

export type CatalogValidationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };
const tags = new Set(['general_repair', 'railing', 'bathroom_support', 'lighting']);

function reject(message: string): never { throw new Error(message); }

function object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return reject(`${path} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return reject(`${path} has an unsupported prototype.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) return reject(`${path} has missing or unsupported fields.`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return reject(`${path}.${key} must be a data property.`);
    result[key] = descriptor.value;
  }
  return result;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return reject(`${path} must be a plain array.`);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as number;
  if (Reflect.ownKeys(value).length !== length + 1) return reject(`${path} must be dense with no extra properties.`);
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return reject(`${path}[${index}] must be a data property.`);
    return descriptor.value;
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 1200 || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return reject(`${path} must be supported nonblank text.`);
  return value;
}

function id(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(result)) return reject(`${path} must be a supported ID.`);
  return result;
}

function records(value: unknown, path: string, fields: readonly string[]): ReadonlyMap<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const [index, item] of array(value, path).entries()) {
    const record = object(item, `${path}[${index}]`, fields);
    const itemId = id(record.id, `${path}[${index}].id`);
    if (result.has(itemId)) return reject(`${path} repeats ID ${itemId}.`);
    result.set(itemId, record);
  }
  if (!result.size) return reject(`${path} must not be empty.`);
  return result;
}

function strings(value: unknown, path: string, allowed?: ReadonlySet<string>): readonly string[] {
  const result = array(value, path).map((entry, index) => text(entry, `${path}[${index}]`));
  if (result.length === 0 || new Set(result).size !== result.length || (allowed && result.some((entry) => !allowed.has(entry)))) return reject(`${path} must contain unique supported values.`);
  return result;
}

function link(value: unknown, registry: ReadonlyMap<string, unknown>, path: string): string {
  const result = id(value, path);
  if (!registry.has(result)) return reject(`${path} references unknown ID ${result}.`);
  return result;
}

function source(value: unknown, path: string) {
  const record = object(value, path, ['status', 'label', 'citationUrl', 'verifiedAt']);
  text(record.label, `${path}.label`);
  if (record.status !== 'synthetic' || record.citationUrl !== null || record.verifiedAt !== null) return reject(`${path} must remain synthetic with no citation or verification date.`);
}

/** Validate the complete authored catalog before showing its browser journey. */
export function validateCatalog(value: unknown): CatalogValidationResult {
  try {
    const scenario = object(value, 'scenario', ['id', 'schemaVersion', 'title', 'synthetic', 'disclosure', 'rooms', 'checklist', 'evidence', 'concerns', 'referenceActions', 'factDefinitions', 'profiles', 'programs', 'localHelpResources', 'requests']);
    id(scenario.id, 'scenario.id'); text(scenario.title, 'scenario.title'); text(scenario.disclosure, 'scenario.disclosure');
    if (scenario.schemaVersion !== 2 || scenario.synthetic !== true) return reject('Only the synthetic schema-v2 catalog is supported.');
    const rooms = records(scenario.rooms, 'rooms', ['id', 'name', 'photoUrl']);
    const actions = records(scenario.referenceActions, 'referenceActions', ['id', 'title', 'description', 'nextStep', 'effort', 'nextStepSource', 'source', 'guidance', 'fundingTags', 'helpRouting', 'cost']);
    const checklist = records(scenario.checklist, 'checklist', ['id', 'roomId', 'prompt', 'referenceActionId']);
    const evidence = records(scenario.evidence, 'evidence', ['id', 'roomId', 'checklistItemId', 'observation', 'imageUrl', 'source']);
    const concerns = records(scenario.concerns, 'concerns', ['id', 'evidenceIds', 'referenceActionId', 'confirmation']);
    const profiles = records(scenario.profiles, 'profiles', ['id', 'label', 'fictional', 'facts']);
    const programs = records(scenario.programs, 'programs', ['id', 'name', 'fictional', 'description', 'source', 'contact', 'rule', 'coverageTags', 'unmodeledRequirements']);
    if (array(scenario.requests, 'requests').length !== 0) return reject('Catalog request templates must be empty; family records belong to workflow state.');
    for (const [roomId, room] of rooms) {
      text(room.name, `rooms.${roomId}.name`);
      if (room.photoUrl !== null) return reject('The text-only synthetic catalog does not support room photos.');
    }
    for (const [actionId, action] of actions) {
      text(action.title, `actions.${actionId}.title`); text(action.description, `actions.${actionId}.description`);
      text(action.nextStep, `actions.${actionId}.nextStep`);
      if (!['quick_fix', 'helper_task', 'professional'].includes(action.effort as string) || action.nextStepSource !== 'Based on CDC 2017 Check for Safety') return reject('Unsupported next-step effort or source.');
      source(action.source, `actions.${actionId}.source`);
      strings(action.fundingTags, `actions.${actionId}.fundingTags`, tags);
      const routing = object(action.helpRouting, `actions.${actionId}.helpRouting`, ['kind', 'explanation']);
      if (routing.kind !== 'family_review' && routing.kind !== 'professional_review') return reject(`Unsupported help-routing kind for ${actionId}.`);
      if ((action.effort === 'professional') !== (routing.kind === 'professional_review')) return reject('Effort and help routing must agree.');
      text(routing.explanation, `actions.${actionId}.helpRouting.explanation`);
      const cost = object(action.cost, `actions.${actionId}.cost`, ['status', 'explanation']);
      if (cost.status !== 'unknown') return reject(`Cost for ${actionId} must remain unknown.`);
      text(cost.explanation, `actions.${actionId}.cost.explanation`);
      const guidance = object(action.guidance, `actions.${actionId}.guidance`, ['title', 'url', 'section', 'reviewedOn']);
      text(guidance.title, `actions.${actionId}.guidance.title`); text(guidance.section, `actions.${actionId}.guidance.section`);
      if (guidance.url !== 'https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf') return reject(`Unsupported reference URL for ${actionId}.`);
      if (typeof guidance.reviewedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(guidance.reviewedOn)
        || !Number.isFinite(Date.parse(`${guidance.reviewedOn}T00:00:00.000Z`))
        || new Date(`${guidance.reviewedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== guidance.reviewedOn) return reject(`Invalid reference review date for ${actionId}.`);
    }
    for (const [checkId, item] of checklist) {
      text(item.prompt, `checklist.${checkId}.prompt`);
      link(item.roomId, rooms, `checklist.${checkId}.roomId`);
      link(item.referenceActionId, actions, `checklist.${checkId}.referenceActionId`);
    }
    for (const [evidenceId, item] of evidence) {
      const roomId = link(item.roomId, rooms, `evidence.${evidenceId}.roomId`);
      const checkId = link(item.checklistItemId, checklist, `evidence.${evidenceId}.checklistItemId`);
      if (checklist.get(checkId)!.roomId !== roomId) return reject(`Evidence ${evidenceId} and its checklist item disagree on room.`);
      text(item.observation, `evidence.${evidenceId}.observation`); source(item.source, `evidence.${evidenceId}.source`);
      if (item.imageUrl !== null) return reject('The synthetic catalog does not support evidence images.');
    }
    for (const [concernId, concern] of concerns) {
      const actionId = link(concern.referenceActionId, actions, `concerns.${concernId}.referenceActionId`);
      for (const evidenceId of strings(concern.evidenceIds, `concerns.${concernId}.evidenceIds`)) {
        link(evidenceId, evidence, `concerns.${concernId}.evidenceIds`);
        const checkId = evidence.get(evidenceId)!.checklistItemId as string;
        if (checklist.get(checkId)!.referenceActionId !== actionId) return reject(`Concern ${concernId} has mismatched backing actions.`);
      }
      const confirmation = object(concern.confirmation, `concerns.${concernId}.confirmation`, ['humanConfirmed', 'confirmedBy', 'confirmedAt']);
      if (confirmation.humanConfirmed !== false || confirmation.confirmedBy !== null || confirmation.confirmedAt !== null) return reject('Catalog concerns must start explicitly unconfirmed.');
    }
    if (!profiles.has('unknown-profile')) return reject('The unknown-profile default is required.');
    for (const [profileId, profile] of profiles) {
      if (profile.fictional !== true || !/fictional/i.test(text(profile.label, `profiles.${profileId}.label`))) return reject(`Profile ${profileId} must be explicitly fictional.`);
    }
    const unknownFacts = profiles.get('unknown-profile')!.facts;
    object(unknownFacts, 'unknown-profile.facts', []);
    for (const [programId, program] of programs) {
      if (program.fictional !== true || program.contact !== null || !/fictional/i.test(text(program.name, `programs.${programId}.name`))
        || !/does not exist/i.test(text(program.description, `programs.${programId}.description`))) return reject(`Program ${programId} must be explicitly fictional with no contact.`);
      source(program.source, `programs.${programId}.source`);
      strings(program.coverageTags, `programs.${programId}.coverageTags`, tags);
      strings(program.unmodeledRequirements, `programs.${programId}.unmodeledRequirements`);
      for (const [profileId, profile] of profiles) {
        const evaluation = evaluateFactRule(program.rule, scenario.factDefinitions as readonly FactDefinition[], profile.facts);
        if (!evaluation.ok) return reject(`Program ${programId} / profile ${profileId}: ${evaluation.error}`);
      }
    }
    const resources = records(scenario.localHelpResources, 'localHelpResources', ['id', 'name', 'description', 'url', 'phone', 'source']);
    for (const [resourceId, resource] of resources) {
      text(resource.name, resourceId); text(resource.description, resourceId); text(resource.phone, resourceId);
      const src = object(resource.source, resourceId + '.source', ['status', 'label', 'citationUrl', 'verifiedAt']);
      text(src.label, resourceId);
      if (src.status !== 'verified' || resource.url !== 'https://eldercare.acl.gov/' || src.citationUrl !== resource.url || src.verifiedAt !== '2026-10-18') return reject('Local-help resource must have its verified primary source and date.');
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Catalog validation failed.' };
  }
}

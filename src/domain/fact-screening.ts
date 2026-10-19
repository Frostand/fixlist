import type { CriterionStatus } from './types';

interface FactBase {
  readonly id: string;
  readonly label: string;
}

/** Trusted authored definitions are still validated at the evaluation boundary. */
export type FactDefinition =
  | (FactBase & { readonly type: 'boolean' })
  | (FactBase & {
      readonly type: 'number';
      readonly min: number;
      readonly max: number;
      readonly unit: string;
      readonly integer?: boolean;
    })
  | (FactBase & { readonly type: 'enum'; readonly values: readonly string[] });

/** Absent keys and null mean unknown. Explicit undefined is not a data value. */
export type FactValues = Readonly<Record<string, boolean | number | string | null>>;

interface RuleBase {
  readonly id: string;
  readonly label: string;
}

export type FactRule =
  | (RuleBase & { readonly op: 'eq'; readonly factId: string; readonly value: boolean | number | string })
  | (RuleBase & { readonly op: 'gte' | 'lte'; readonly factId: string; readonly value: number })
  | (RuleBase & { readonly op: 'all' | 'any'; readonly children: readonly FactRule[] });

export interface RuleResult {
  readonly id: string;
  readonly label: string;
  readonly status: CriterionStatus;
  readonly explanation: string;
  /** Leaves have no children; groups retain every child in authored order. */
  readonly children: readonly RuleResult[];
}

export type FactEvaluation =
  | { readonly ok: true; readonly result: RuleResult }
  | { readonly ok: false; readonly error: string };

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_DEPTH = 8;
const MAX_NODES = 64;

class InvalidInput extends Error {}

function invalid(message: string): never {
  throw new InvalidInput(message);
}

/** Read descriptors first so ordinary accessors are rejected without execution. */
function dataRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(`${path} must be a plain data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(`${path} must not have a custom prototype.`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return invalid(`${path} must not have symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      return invalid(`${path}.${key} must be an enumerable data property.`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function dataArray(value: unknown, path: string, maximumLength?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return invalid(`${path} must be a plain data array.`);
  }
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as number;
  if (maximumLength !== undefined && length > maximumLength) {
    return invalid(`${path} exceeds the ${maximumLength}-item limit.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return invalid(`${path} must be dense and have no extra properties.`);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      return invalid(`${path}[${index}] must be an enumerable data property.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function shape(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(record, key)) || Object.keys(record).some((key) => !allowed.has(key))) {
    invalid(`${path} has missing or unsupported fields.`);
  }
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return invalid(`${path} must be a 1–64 character ID starting with a letter and using letters, numbers, _ or -.`);
  }
  return value;
}

function text(value: unknown, path: string, maximumLength = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength || value !== value.trim() || CONTROL_PATTERN.test(value)) {
    return invalid(`${path} must be nonblank text of at most ${maximumLength} characters without surrounding whitespace or control characters.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(`${path} must be a finite number.`);
  return value;
}

function registry(definitions: unknown): ReadonlyMap<string, FactDefinition> {
  const result = new Map<string, FactDefinition>();
  for (const [index, item] of dataArray(definitions, 'definitions').entries()) {
    const path = `definitions[${index}]`;
    const record = dataRecord(item, path);
    const definitionId = id(record.id, `${path}.id`);
    const label = text(record.label, `${path}.label`);
    if (result.has(definitionId)) return invalid(`${path} repeats fact ID ${definitionId}.`);
    switch (record.type) {
      case 'boolean':
        shape(record, ['id', 'label', 'type'], [], path);
        result.set(definitionId, { id: definitionId, label, type: 'boolean' });
        break;
      case 'number': {
        shape(record, ['id', 'label', 'type', 'min', 'max', 'unit'], ['integer'], path);
        const min = finiteNumber(record.min, `${path}.min`);
        const max = finiteNumber(record.max, `${path}.max`);
        const unit = text(record.unit, `${path}.unit`, 40);
        if (min > max) return invalid(`${path}.min must not exceed max.`);
        if (Object.hasOwn(record, 'integer') && typeof record.integer !== 'boolean') {
          return invalid(`${path}.integer must be a boolean when supplied.`);
        }
        if (record.integer === true && Math.ceil(min) > Math.floor(max)) {
          return invalid(`${path} must permit at least one integer.`);
        }
        result.set(definitionId, {
          id: definitionId, label, type: 'number', min, max, unit,
          ...(Object.hasOwn(record, 'integer') ? { integer: record.integer as boolean } : {}),
        });
        break;
      }
      case 'enum': {
        shape(record, ['id', 'label', 'type', 'values'], [], path);
        const values = dataArray(record.values, `${path}.values`).map((value, valueIndex) => text(value, `${path}.values[${valueIndex}]`, 80));
        if (values.length === 0 || new Set(values).size !== values.length) {
          return invalid(`${path}.values must be nonempty and unique.`);
        }
        result.set(definitionId, { id: definitionId, label, type: 'enum', values });
        break;
      }
      default:
        return invalid(`${path}.type is unsupported.`);
    }
  }
  return result;
}

function factValue(value: unknown, definition: FactDefinition, path: string): boolean | number | string {
  switch (definition.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return invalid(`${path} must be a boolean.`);
      return value;
    case 'number': {
      const number = finiteNumber(value, path);
      if (number < definition.min || number > definition.max || (definition.integer === true && !Number.isInteger(number))) {
        return invalid(`${path} must be within ${definition.min}..${definition.max}${definition.integer ? ' and an integer' : ''}.`);
      }
      return number;
    }
    case 'enum':
      if (typeof value !== 'string' || !definition.values.includes(value)) return invalid(`${path} must be an allowed enum value.`);
      return value;
  }
}

function ruleTree(value: unknown, definitions: ReadonlyMap<string, FactDefinition>): FactRule {
  const ids = new Set<string>();
  const ancestors = new WeakSet<object>();
  let nodeCount = 0;
  function visit(node: unknown, depth: number, path: string): FactRule {
    if (depth > MAX_DEPTH) return invalid(`Rule tree exceeds maximum depth ${MAX_DEPTH} (root depth is 1).`);
    nodeCount += 1;
    if (nodeCount > MAX_NODES) return invalid(`Rule tree exceeds maximum ${MAX_NODES} nodes.`);
    if (node !== null && typeof node === 'object' && ancestors.has(node)) return invalid(`${path} contains a cycle.`);
    const record = dataRecord(node, path);
    const ruleId = id(record.id, `${path}.id`);
    const label = text(record.label, `${path}.label`);
    if (ids.has(ruleId)) return invalid(`${path} repeats rule ID ${ruleId}.`);
    ids.add(ruleId);
    if (record.op === 'all' || record.op === 'any') {
      shape(record, ['id', 'label', 'op', 'children'], [], path);
      const children = dataArray(record.children, `${path}.children`, MAX_NODES);
      if (children.length === 0) return invalid(`${path}.children must not be empty.`);
      ancestors.add(node as object);
      const validatedChildren = children.map((child, index) => visit(child, depth + 1, `${path}.children[${index}]`));
      ancestors.delete(node as object);
      return { id: ruleId, label, op: record.op, children: validatedChildren };
    }
    if (record.op !== 'eq' && record.op !== 'gte' && record.op !== 'lte') return invalid(`${path}.op is unsupported.`);
    shape(record, ['id', 'label', 'op', 'factId', 'value'], [], path);
    const factId = id(record.factId, `${path}.factId`);
    const definition = definitions.get(factId);
    if (!definition) return invalid(`${path} references unknown fact ${factId}.`);
    if (record.op !== 'eq' && definition.type !== 'number') return invalid(`${path}.${record.op} requires a number fact.`);
    const expected = factValue(record.value, definition, `${path}.value`);
    return record.op === 'eq'
      ? { id: ruleId, label, op: 'eq', factId, value: expected }
      : { id: ruleId, label, op: record.op, factId, value: expected as number };
  }
  return visit(value, 1, 'rule');
}

function factValues(value: unknown, definitions: ReadonlyMap<string, FactDefinition>): ReadonlyMap<string, boolean | number | string | null> {
  const record = dataRecord(value, 'facts');
  const result = new Map<string, boolean | number | string | null>();
  for (const [key, entry] of Object.entries(record)) {
    const definition = definitions.get(key);
    if (!definition) return invalid(`facts contains unknown fact ${key}.`);
    result.set(key, entry === null ? null : factValue(entry, definition, `facts.${key}`));
  }
  return result;
}

function display(value: boolean | number | string, definition: FactDefinition): string {
  return definition.type === 'number' ? `${value} ${definition.unit}` : JSON.stringify(value);
}

function evaluate(rule: FactRule, definitions: ReadonlyMap<string, FactDefinition>, facts: ReadonlyMap<string, boolean | number | string | null>): RuleResult {
  if ('children' in rule) {
    const children = rule.children.map((child) => evaluate(child, definitions, facts));
    const hasMet = children.some((child) => child.status === 'met');
    const hasFailure = children.some((child) => child.status === 'not_met');
    const hasUnknown = children.some((child) => child.status === 'unknown');
    const status: CriterionStatus = rule.op === 'all'
      ? hasFailure ? 'not_met' : hasUnknown ? 'unknown' : 'met'
      : hasMet ? 'met' : hasUnknown ? 'unknown' : 'not_met';
    const explanation = rule.op === 'all'
      ? `All ${children.length} conditions are required. ${hasFailure ? 'At least one condition is not met.' : hasUnknown ? 'At least one condition is unknown.' : 'Every condition is met.'} Every child result is retained.`
      : `At least one of ${children.length} conditions is required. ${hasMet ? 'At least one condition is met.' : hasUnknown ? 'No condition is met and at least one is unknown.' : 'Every condition is not met.'} Every child result is retained.`;
    return { id: rule.id, label: rule.label, status, explanation, children };
  }
  const definition = definitions.get(rule.factId)!;
  const actual = facts.get(rule.factId);
  const comparison = rule.op === 'eq' ? 'equal to' : rule.op === 'gte' ? 'at least' : 'at most';
  const expectation = `${comparison} ${display(rule.value, definition)}`;
  if (actual === undefined || actual === null) {
    return { id: rule.id, label: rule.label, status: 'unknown', explanation: `${definition.label} is unknown; expected ${expectation}.`, children: [] };
  }
  const met = rule.op === 'eq' ? actual === rule.value : rule.op === 'gte' ? (actual as number) >= rule.value : (actual as number) <= rule.value;
  return {
    id: rule.id, label: rule.label, status: met ? 'met' : 'not_met',
    explanation: `${definition.label} is ${display(actual, definition)}; expected ${expectation}. This condition is ${met ? 'met' : 'not met'}.`,
    children: [],
  };
}

/** Pure, bounded JSON-data screening; no getters, expressions, clocks or services. */
export function evaluateFactRule(rule: unknown, definitions: readonly FactDefinition[], facts: unknown): FactEvaluation {
  try {
    const checkedDefinitions = registry(definitions);
    const checkedRule = ruleTree(rule, checkedDefinitions);
    const checkedFacts = factValues(facts, checkedDefinitions);
    return { ok: true, result: evaluate(checkedRule, checkedDefinitions, checkedFacts) };
  } catch (error) {
    return { ok: false, error: error instanceof InvalidInput ? error.message : 'Input could not be validated as plain screening data.' };
  }
}

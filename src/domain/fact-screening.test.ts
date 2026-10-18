import { describe, expect, it } from 'vitest';
import { evaluateFactRule, type FactDefinition, type FactRule, type FactValues, type RuleResult } from './fact-screening';

const definitions: readonly FactDefinition[] = [
  { id: 'owner', label: 'Fictional ownership', type: 'boolean' },
  { id: 'resident', label: 'Fictional residency', type: 'boolean' },
  { id: 'age', label: 'Fictional age', type: 'number', min: 0, max: 120, unit: 'years', integer: true },
  { id: 'income', label: 'Fictional income', type: 'number', min: 0, max: 1000000, unit: 'USD/year', integer: true },
  { id: 'measurement', label: 'Fictional measurement', type: 'number', min: -20, max: 50, unit: 'units' },
  { id: 'area', label: 'Fictional area', type: 'enum', values: ['maple', 'cedar'] },
];

function eq(id: string, factId: string, value: boolean | number | string): FactRule {
  return { id, label: `Rule ${id}`, op: 'eq', factId, value };
}

const ownership = eq('owns-home', 'owner', true);

function result(rule: unknown, facts: unknown = {}, registry = definitions): RuleResult {
  const evaluated = evaluateFactRule(rule, registry, facts);
  if (!evaluated.ok) throw new Error(evaluated.error);
  return evaluated.result;
}

function invalid(rule: unknown, facts: unknown, ...registries: readonly unknown[]) {
  const registry = registries.length === 0 ? definitions : registries[0];
  const evaluated = evaluateFactRule(rule, registry as readonly FactDefinition[], facts);
  expect(evaluated.ok).toBe(false);
  if (evaluated.ok) throw new Error('Malformed input unexpectedly produced a result.');
  expect(evaluated.error.length).toBeGreaterThan(0);
  expect(evaluated).not.toHaveProperty('result');
  return evaluated.error;
}

const statuses = ['met', 'not_met', 'unknown'] as const;
const pairs = statuses.flatMap((left) => statuses.map((right) => ({ left, right })));

describe('complete three-valued groups', () => {
  for (const op of ['all', 'any'] as const) {
    it.each(pairs)(`${op} preserves both children for $left and $right`, ({ left, right }) => {
      const facts: FactValues = Object.fromEntries(
        [['owner', left], ['resident', right]]
          .filter(([, status]) => status !== 'unknown')
          .map(([key, status]) => [key, status === 'met']),
      );
      const tree = result({ id: 'both', label: 'Fictional conditions', op, children: [ownership, eq('lives-here', 'resident', true)] }, facts);
      const expected = op === 'all'
        ? left === 'not_met' || right === 'not_met' ? 'not_met' : left === 'unknown' || right === 'unknown' ? 'unknown' : 'met'
        : left === 'met' || right === 'met' ? 'met' : left === 'unknown' || right === 'unknown' ? 'unknown' : 'not_met';
      expect(tree.status).toBe(expected);
      expect(tree.children.map((child) => child.status)).toEqual([left, right]);
      expect(tree.children.map((child) => child.id)).toEqual(['owns-home', 'lives-here']);
      expect(tree.children.every((child) => child.explanation.length > 0 && child.children.length === 0)).toBe(true);
      expect(tree.explanation).toContain('Every child result is retained.');
    });
  }

  it('retains nested unknown results even when a sibling determines the root', () => {
    const rule: FactRule = {
      id: 'program', label: 'Fictional program', op: 'all', children: [
        eq('area-check', 'area', 'maple'),
        { id: 'connection', label: 'Fictional connection', op: 'any', children: [ownership, eq('residency-check', 'resident', true)] },
        { id: 'age-check', label: 'Fictional age threshold', op: 'gte', factId: 'age', value: 65 },
      ],
    };
    const evaluated = result(rule, { area: 'cedar', owner: null, age: 65 });
    expect(evaluated.status).toBe('not_met');
    expect(evaluated.children.map((child) => child.status)).toEqual(['not_met', 'unknown', 'met']);
    expect(evaluated.children[1]?.children.map((child) => child.status)).toEqual(['unknown', 'unknown']);
    expect(result(rule, { area: 'maple', owner: false, resident: true, age: 65 }).status).toBe('met');
    expect(result(rule, { area: 'maple', owner: false, age: 65 }).status).toBe('unknown');
  });

  it.each(['all', 'any'] as const)('accepts a nonempty one-child %s group', (op) => {
    const evaluated = result({ id: 'one', label: 'One condition', op, children: [ownership] }, { owner: false });
    expect(evaluated.status).toBe('not_met');
    expect(evaluated.children).toHaveLength(1);
  });
});

describe('typed facts and inclusive comparison boundaries', () => {
  it.each([
    { op: 'gte', value: 65, actual: 64, status: 'not_met' },
    { op: 'gte', value: 65, actual: 65, status: 'met' },
    { op: 'gte', value: 65, actual: 66, status: 'met' },
    { op: 'lte', value: 65, actual: 64, status: 'met' },
    { op: 'lte', value: 65, actual: 65, status: 'met' },
    { op: 'lte', value: 65, actual: 66, status: 'not_met' },
    { op: 'eq', value: 0, actual: 0, status: 'met' },
    { op: 'eq', value: 120, actual: 120, status: 'met' },
  ])('$actual $op $value is $status', ({ op, value, actual, status }) => {
    expect(result({ id: 'age-check', label: 'Fictional age check', op, factId: 'age', value }, { age: actual }).status).toBe(status);
  });

  it('preserves false and zero as known facts', () => {
    expect(result(eq('false-check', 'owner', false), { owner: false }).status).toBe('met');
    expect(result(ownership, { owner: false }).status).toBe('not_met');
    const evaluated = result(eq('zero-check', 'income', 0), { income: 0 });
    expect(evaluated.status).toBe('met');
    expect(evaluated.explanation).toContain('0 USD/year');
  });

  it('gives missing and null facts the same unknown explanation', () => {
    expect(result(ownership, {})).toEqual(result(ownership, { owner: null }));
    expect(result(ownership).status).toBe('unknown');
    expect(result(ownership).explanation).toContain('unknown');
  });

  it('supports enum equality and bounded noninteger numerical facts', () => {
    expect(result(eq('area-check', 'area', 'maple'), { area: 'maple' }).status).toBe('met');
    expect(result(eq('area-check', 'area', 'maple'), { area: 'cedar' }).status).toBe('not_met');
    expect(result({ id: 'decimal', label: 'Decimal threshold', op: 'lte', factId: 'measurement', value: 12.5 }, { measurement: 12.5 }).status).toBe('met');
    expect(result(eq('lower-bound', 'measurement', -20), { measurement: -20 }).status).toBe('met');
    expect(result(eq('upper-bound', 'measurement', 50), { measurement: 50 }).status).toBe('met');
  });

  it.each([
    null, undefined, [], 'facts', 0, false,
    { owner: 'true' }, { owner: 1 }, { owner: undefined },
    { age: '65' }, { age: 65.5 }, { age: -1 }, { age: 121 },
    { age: Number.NaN }, { age: Infinity }, { age: -Infinity },
    { measurement: -20.1 }, { measurement: 50.1 },
    { area: 'unknown-area' }, { area: true }, { owner: true, secret: null },
    { owner: true, income: 1000001 }, { owner: true, income: undefined },
    new Date('2026-10-17T00:00:00Z'), Object.create({ owner: true }),
  ].map((facts) => ({ facts })))('rejects invalid fact input %# before any match', ({ facts }) => {
    invalid(ownership, facts);
  });
});

describe('full registry validation', () => {
  const valid = definitions[0]!;
  it.each([
    null, undefined, {}, [null], [true], [new Date()],
    [valid, valid],
    [{ ...valid, id: '' }], [{ ...valid, id: 'bad id' }], [{ ...valid, id: 'a'.repeat(65) }],
    [{ ...valid, label: '' }], [{ ...valid, label: ' ' }], [{ ...valid, label: ' label' }],
    [{ ...valid, label: 'a'.repeat(161) }], [{ ...valid, label: 'control\nlabel' }],
    [{ ...valid, extra: true }], [{ id: 'owner', type: 'boolean' }],
    [{ ...valid, type: 'string' }],
    [{ id: 'n', label: 'N', type: 'number', min: 10, max: 9, unit: 'years' }],
    [{ id: 'n', label: 'N', type: 'number', min: 0, max: Infinity, unit: 'years' }],
    [{ id: 'n', label: 'N', type: 'number', min: Number.NaN, max: 10, unit: 'years' }],
    [{ id: 'n', label: 'N', type: 'number', min: '0', max: 10, unit: 'years' }],
    [{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, unit: '' }],
    [{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, unit: 'a'.repeat(41) }],
    [{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, unit: 'years', integer: 'yes' }],
    [{ id: 'n', label: 'N', type: 'number', min: 0.1, max: 0.9, unit: 'years', integer: true }],
    [{ id: 'e', label: 'E', type: 'enum', values: [] }],
    [{ id: 'e', label: 'E', type: 'enum', values: ['a', 'a'] }],
    [{ id: 'e', label: 'E', type: 'enum', values: [''] }],
    [{ id: 'e', label: 'E', type: 'enum', values: ['a'.repeat(81)] }],
    [{ id: 'e', label: 'E', type: 'enum', values: [1] }],
    [{ id: 'e', label: 'E', type: 'enum', values: 'a' }],
  ].map((registry) => ({ registry })))('rejects invalid registry %#', ({ registry }) => {
    invalid(ownership, { owner: true }, registry);
  });

  it('checks unused definitions before a matching leaf is evaluated', () => {
    invalid(ownership, { owner: true }, [valid, { id: 'unused', label: 'Unused', type: 'enum', values: [] }]);
  });

  it('identifies duplicate fact IDs explicitly', () => {
    expect(invalid(ownership, { owner: true }, [valid, valid])).toContain('repeats fact ID owner');
  });

  it('accepts a singleton number range and explicit noninteger definitions', () => {
    const singleton: readonly FactDefinition[] = [{ id: 'n', label: 'N', type: 'number', min: 0, max: 0, unit: 'units', integer: true }];
    expect(result(eq('singleton', 'n', 0), { n: 0 }, singleton).status).toBe('met');
    const decimals: readonly FactDefinition[] = [{ id: 'n', label: 'N', type: 'number', min: 0.1, max: 0.9, unit: 'units', integer: false }];
    expect(result(eq('decimal', 'n', 0.5), { n: 0.5 }, decimals).status).toBe('met');
  });
});

describe('full rule validation', () => {
  it.each([
    null, undefined, [], 'rule', true, new Date(),
    { ...ownership, id: '' }, { ...ownership, id: 'a'.repeat(65) }, { ...ownership, id: '0bad' },
    { ...ownership, label: '' }, { ...ownership, label: 'a'.repeat(161) }, { ...ownership, label: 'rule\nlabel' },
    { ...ownership, extra: true }, { ...ownership, op: 'eval' },
    { ...ownership, factId: 'missing' }, { ...ownership, factId: '' },
    { id: 'missing-value', label: 'Missing value', op: 'eq', factId: 'owner' },
    { ...ownership, value: null }, { ...ownership, value: undefined }, { ...ownership, value: 'true' },
    { ...ownership, op: 'gte', value: true }, { ...ownership, op: 'lte', value: 1 },
    { id: 'enum-order', label: 'Enum order', op: 'gte', factId: 'area', value: 'maple' },
    { id: 'enum-value', label: 'Enum value', op: 'eq', factId: 'area', value: 'missing' },
    { id: 'age-value', label: 'Age value', op: 'gte', factId: 'age', value: 65.5 },
    { id: 'age-range', label: 'Age range', op: 'lte', factId: 'age', value: 121 },
    { id: 'age-nan', label: 'Age value', op: 'eq', factId: 'age', value: Number.NaN },
    { id: 'age-type', label: 'Age value', op: 'eq', factId: 'age', value: '65' },
    { id: 'empty-all', label: 'Empty all', op: 'all', children: [] },
    { id: 'empty-any', label: 'Empty any', op: 'any', children: [] },
    { id: 'no-children', label: 'No children', op: 'all' },
    { id: 'bad-children', label: 'Bad children', op: 'any', children: {} },
    { id: 'mixed-group', label: 'Mixed group', op: 'all', children: [ownership], factId: 'owner' },
    { ...ownership, children: [] },
  ].map((rule) => ({ rule })))('rejects malformed rule %#', ({ rule }) => {
    invalid(rule, { owner: true });
  });

  it.each(['all', 'any'] as const)('validates hidden branches in a decisive %s group', (op) => {
    const decisiveValue = op === 'any';
    const rule = { id: 'root', label: 'Root', op, children: [ownership, { ...ownership, id: 'hidden', factId: 'missing' }] };
    expect(invalid(rule, { owner: decisiveValue })).toContain('unknown fact missing');
  });

  it('rejects duplicate IDs throughout nested branches', () => {
    const rule = { id: 'root', label: 'Root', op: 'any', children: [ownership, { id: 'nested', label: 'Nested', op: 'all', children: [ownership] }] };
    expect(invalid(rule, { owner: true })).toContain('repeats rule ID');
  });

  it('rejects rule cycles without recursion overflow', () => {
    const cycle: { id: string; label: string; op: string; children: unknown[] } = { id: 'cycle', label: 'Cycle', op: 'any', children: [] };
    cycle.children.push(cycle);
    expect(invalid(cycle, { owner: true })).toContain('cycle');
  });

  function chain(depth: number): FactRule {
    let rule = ownership;
    for (let index = 1; index < depth; index += 1) {
      rule = { id: `group-${index}`, label: `Group ${index}`, op: 'all', children: [rule] };
    }
    return rule;
  }

  it('accepts root depth 1 through maximum depth 8, and rejects depth 9', () => {
    expect(result(chain(1), { owner: true }).status).toBe('met');
    expect(result(chain(8), { owner: true }).status).toBe('met');
    expect(invalid(chain(9), { owner: true })).toContain('maximum depth 8');
  });

  it('accepts exactly 64 nodes and rejects a 65-node tree', () => {
    const children = Array.from({ length: 63 }, (_, index) => eq(`leaf-${index}`, 'owner', true));
    const root = { id: 'root', label: 'Root', op: 'any', children };
    expect(result(root, { owner: true }).children).toHaveLength(63);
    expect(invalid({ ...root, children: [...children, eq('leaf-63', 'owner', true)] }, { owner: true })).toContain('maximum 64 nodes');
  });
});

describe('ordinary JS data boundary without getter execution', () => {
  it('rejects accessors on rules, definitions, facts and array elements without calling them', () => {
    let getterCalls = 0;
    const getter = () => { getterCalls += 1; throw new Error('Must never run'); };
    const rule = Object.defineProperty({ ...ownership }, 'value', { enumerable: true, get: getter });
    const definition = Object.defineProperty({ ...definitions[0] }, 'type', { enumerable: true, get: getter });
    const facts = Object.defineProperty({}, 'owner', { enumerable: true, get: getter });
    const children = Object.defineProperty([ownership], '0', { enumerable: true, get: getter });
    const registry = Object.defineProperty([definitions[0]], '0', { enumerable: true, get: getter });
    invalid(rule, { owner: true });
    invalid(ownership, { owner: true }, [definition]);
    invalid(ownership, facts);
    invalid({ id: 'group', label: 'Group', op: 'all', children }, { owner: true });
    invalid(ownership, { owner: true }, registry);
    expect(getterCalls).toBe(0);
  });

  it('rejects custom prototypes at every object and array boundary', () => {
    const rule = Object.assign(Object.create({ inherited: true }), ownership);
    const definition = Object.assign(Object.create({ inherited: true }), definitions[0]);
    class CustomArray<T> extends Array<T> {}
    invalid(rule, { owner: true });
    invalid(ownership, { owner: true }, [definition]);
    invalid(ownership, Object.assign(Object.create({ inherited: true }), { owner: true }));
    invalid(ownership, { owner: true }, new CustomArray(...definitions));
    invalid({ id: 'group', label: 'Group', op: 'all', children: new CustomArray(ownership) }, { owner: true });
  });

  it('rejects symbol keys, nonenumerable properties, sparse arrays and extra array properties', () => {
    const symbol = Symbol('hidden');
    invalid({ ...ownership, [symbol]: true }, { owner: true });
    invalid(ownership, { owner: true, [symbol]: true });
    invalid(ownership, { owner: true }, [{ ...definitions[0], [symbol]: true }]);
    invalid(Object.defineProperty({ ...ownership }, 'hidden', { value: true }), { owner: true });
    invalid(ownership, Object.defineProperty({ owner: true }, 'hidden', { value: true }));
    invalid(ownership, { owner: true }, new Array(1));
    invalid({ id: 'group', label: 'Group', op: 'all', children: Object.assign([ownership], { extra: true }) }, { owner: true });
    invalid({ id: 'group', label: 'Group', op: 'all', children: new Array(1) }, { owner: true });
  });

  it('supports null-prototype plain data without inherited lookups', () => {
    const rule = Object.assign(Object.create(null), ownership);
    const registry = definitions.map((definition) => Object.assign(Object.create(null), definition));
    const facts = Object.assign(Object.create(null), { owner: true });
    expect(result(rule, facts, registry).status).toBe('met');
    invalid(ownership, JSON.parse('{"owner":true,"__proto__":null}'));
    invalid(ownership, { constructor: null });
  });
});

describe('purity and explainability', () => {
  function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  }

  it('accepts frozen inputs, mutates nothing, and returns fresh deterministic trees', () => {
    const rule: FactRule = deepFreeze({ id: 'root', label: 'Root', op: 'all', children: [ownership, eq('area-check', 'area', 'maple')] });
    const registry = deepFreeze(structuredClone(definitions));
    const facts = deepFreeze({ owner: false, area: null });
    const before = JSON.stringify({ rule, registry, facts });
    const first = result(rule, facts, registry);
    const second = result(rule, facts, registry);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.children).not.toBe(first.children);
    expect(second.children[0]).not.toBe(first.children[0]);
    expect(JSON.stringify({ rule, registry, facts })).toBe(before);
    expect(first).toEqual({
      id: 'root', label: 'Root', status: 'not_met',
      explanation: 'All 2 conditions are required. At least one condition is not met. Every child result is retained.',
      children: [
        { id: 'owns-home', label: 'Rule owns-home', status: 'not_met', explanation: 'Fictional ownership is false; expected equal to true. This condition is not met.', children: [] },
        { id: 'area-check', label: 'Rule area-check', status: 'unknown', explanation: 'Fictional area is unknown; expected equal to "maple".', children: [] },
      ],
    });
  });

  it('includes actual values, numerical units and the expected operator in leaf explanations', () => {
    const evaluated = result({ id: 'income-limit', label: 'Fictional income limit', op: 'lte', factId: 'income', value: 30000 }, { income: 60000 });
    expect(evaluated.explanation).toBe('Fictional income is 60000 USD/year; expected at most 30000 USD/year. This condition is not met.');
  });
});

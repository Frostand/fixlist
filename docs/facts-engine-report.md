# Pure fact-rule engine report

Implemented October 17, 2026. Task 1 is isolated to `src/domain/fact-screening.ts`, its test file, and this report. Existing workflow, fixtures, UI and storage were untouched by this task. No dependencies or external services were added. Primary review remains the acceptance gate for integration.

## Exact exported API

```ts
type FactDefinition =
  | { readonly id: string; readonly label: string; readonly type: 'boolean' }
  | {
      readonly id: string; readonly label: string; readonly type: 'number';
      readonly min: number; readonly max: number; readonly unit: string;
      readonly integer?: boolean;
    }
  | {
      readonly id: string; readonly label: string; readonly type: 'enum';
      readonly values: readonly string[];
    };

type FactValues = Readonly<Record<string, boolean | number | string | null>>;

type FactRule =
  | { readonly id: string; readonly label: string; readonly op: 'eq'; readonly factId: string; readonly value: boolean | number | string }
  | { readonly id: string; readonly label: string; readonly op: 'gte' | 'lte'; readonly factId: string; readonly value: number }
  | { readonly id: string; readonly label: string; readonly op: 'all' | 'any'; readonly children: readonly FactRule[] };

interface RuleResult {
  readonly id: string;
  readonly label: string;
  readonly status: 'met' | 'not_met' | 'unknown';
  readonly explanation: string;
  readonly children: readonly RuleResult[];
}

type FactEvaluation =
  | { readonly ok: true; readonly result: RuleResult }
  | { readonly ok: false; readonly error: string };

function evaluateFactRule(
  rule: unknown,
  definitions: readonly FactDefinition[],
  facts: unknown,
): FactEvaluation;
```

The TypeScript union describes authored rules; cross-fact compatibility is validated at runtime. `gte`/`lte` require numerical definitions. `eq` supports all three definition kinds. Expected rule values must satisfy the referenced definition, including range, integer and enum restrictions. Numerical bounds are inclusive; singleton ranges are supported. An integer definition must permit at least one integer. Missing facts and null have the same unknown result; false and zero stay known. Explicit undefined is invalid.

## Validation and evaluation

Every registry entry, every rule branch and every supplied fact are validated before evaluation. Unknown fact keys (including unused keys), duplicate fact/rule IDs, unsupported/missing fields, incompatible operators, empty groups and invalid hidden branches return an error without a result. Plain objects with `Object.prototype` or null prototypes are accepted; custom object/array prototypes, accessors, symbol keys, nonenumerable fields, sparse arrays and extra array fields are rejected. Descriptor inspection avoids executing getters. Proxy objects remain outside the JSON-data contract.

IDs are 1–64 ASCII characters, start with a letter, and allow letters, digits, `_` and `-`. Labels are 1–160 characters; units allow 1–40; enum values allow 1–80. These text fields reject surrounding whitespace and control characters. Rule trees permit depth 8 including the root at depth 1, and 64 total nodes. Cycles are rejected. No expressions are executed, and the engine performs no I/O, clock reads or input mutations.

`all` gives failure precedence, then unknown, then met. `any` gives met precedence, then unknown, then failure. Every child is evaluated and retained in authored order, even if a sibling determines the group. Leaves have empty child arrays and explain the actual/unknown value, expected comparison and numerical unit. Fresh deterministic result trees do not retain mutable input containers.

## Execution evidence

Environment: Node 24.18.0, npm 11.16.0, existing Vitest 5.0.5.

- `npm test -- src/domain/fact-screening.test.ts`: **138 passed**, 1 file, final run at 08:41:19 local tool output on October 17. Includes all 18 ternary pairs, nested unknown propagation, boundaries, malformed definitions/facts/rules, duplicate IDs, hidden branches, exact depth/node limits, cycles, JS getter/prototype boundaries, frozen-input immutability and exact deterministic explanations.
- `npm run typecheck`: **passed** after the final test-table correction.
- `git diff --check -- src/domain/fact-screening.ts src/domain/fact-screening.test.ts`: passed, though these new files are untracked and primary review should inspect their contents directly.

An initial type-narrowing diagnostic was corrected using the rule union's children property. An initial test helper replaced explicit undefined with defaults; it was corrected. Self-review also wrapped array-valued Vitest table rows to ensure actual malformed registry arrays were exercised. All final tests pass; no known test or typecheck failure remains.

## Limits and next gate

This is a pure synthetic screening building block. It does not certify eligibility, approval, program availability, funding, household safety or repairs. The registry is not a sourced program database. Profiles, program integration, persistence migration, browser behavior, keyboard access and native print were not implemented or validated by Task 1. Primary acceptance is required before those later tasks.

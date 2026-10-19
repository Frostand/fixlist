import type { FactDefinition } from '../domain/fact-screening';
import type { FictionalProfile } from '../domain/types';

export const factDefinitions: readonly FactDefinition[] = [
  { id: 'ageYears', label: 'Fictional age', type: 'number', min: 0, max: 120, unit: 'years', integer: true },
  { id: 'annualIncomeUsd', label: 'Fictional annual income', type: 'number', min: 0, max: 1000000, unit: 'USD/year', integer: true },
  { id: 'area', label: 'Fictional area', type: 'enum', values: ['maple', 'cedar'] },
  { id: 'homeowner', label: 'Fictional homeowner', type: 'boolean' },
  { id: 'resident', label: 'Fictional resident', type: 'boolean' },
];

const mapleOwner = { ageYears: 70, annualIncomeUsd: 20000, area: 'maple', homeowner: true, resident: true } as const;

export const fictionalProfiles: readonly FictionalProfile[] = [
  { id: 'unknown-profile', label: 'Fictional: all facts unknown', fictional: true, facts: {} },
  { id: 'maple-owner', label: 'Fictional: Maple homeowner', fictional: true, facts: { ...mapleOwner } },
  { id: 'maple-renter', label: 'Fictional: Maple renter', fictional: true, facts: { ...mapleOwner, homeowner: false } },
  { id: 'incomplete-maple', label: 'Fictional: Maple with missing facts', fictional: true, facts: { ...mapleOwner, homeowner: null, resident: null } },
  { id: 'outside-area', label: 'Fictional: outside Maple area', fictional: true, facts: { ...mapleOwner, area: 'cedar' } },
  { id: 'over-income', label: 'Fictional: above income limits', fictional: true, facts: { ...mapleOwner, annualIncomeUsd: 60000 } },
  { id: 'boundary-maple', label: 'Fictional: exact age and income boundaries', fictional: true, facts: { ...mapleOwner, ageYears: 65, annualIncomeUsd: 30000 } },
];

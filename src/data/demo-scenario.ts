import type { DemoScenario, GuidanceReference, ReferenceAction, SourceRecord } from '../domain/types';
import { localHelpResources } from './local-help-resources';
import { factDefinitions, fictionalProfiles } from './fictional-profiles';

const syntheticSource = {
  status: 'synthetic', label: 'Authored fictional fixture for the FixList demo', citationUrl: null, verifiedAt: null,
} satisfies SourceRecord;

function guidance(section: string): GuidanceReference {
  return {
    title: 'CDC 2017 Check for Safety',
    url: 'https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf',
    section: `Page 2: ${section}`, reviewedOn: '2026-10-17',
  };
}

const familyReview = {
  kind: 'family_review',
  explanation: 'Discuss the documented concern and an appropriate next step with the resident. Family review is not permission to perform repairs or a claim of qualification.',
} as const;
const professionalReview = {
  kind: 'professional_review',
  explanation: 'Seek review by an appropriately qualified professional for this concern. A local family record logs seeking suitable help; it does not authorize repairs or establish anyone’s qualifications.',
} as const;
const unknownCost = { status: 'unknown', explanation: 'No cost estimate is available; the demo provides no pricing or funding promise.' } as const;

interface SampleConcern {
  checklistId: string;
  concernId: string;
  evidenceId: string;
  roomId: string;
  prompt: string;
  observation: string;
  action: ReferenceAction;
}

const samples: readonly SampleConcern[] = [
  {
    checklistId: 'rug-check', concernId: 'rug-concern', evidenceId: 'rug-observation', roomId: 'living-room',
    prompt: 'Does a rug edge obstruct the walking route?',
    observation: 'Scripted sample observation: a rug edge crosses the walkway.',
    action: {
      nextStep: 'Take up the rug, or hold it down with double-sided rug tape or a non-slip pad.', effort: 'quick_fix', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-rug', title: 'Review the rug placement',
      description: 'Demo reference text: discuss the documented obstruction with the resident before deciding on an action.',
      source: syntheticSource, guidance: guidance('Floors — rugs'), fundingTags: ['general_repair'], helpRouting: familyReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'cord-check', concernId: 'cord-concern', evidenceId: 'cord-observation', roomId: 'hallway',
    prompt: 'Does a cord cross the walking route?',
    observation: 'Scripted sample observation: a lamp cord crosses the hallway.',
    action: {
      nextStep: 'Move the cord along the wall and tape or clip it down so it does not cross the path. If you need another outlet, ask an electrician.', effort: 'quick_fix', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-cord', title: 'Review the cord route',
      description: 'Demo reference text: document the cord route and agree on a next step with the resident.',
      source: syntheticSource, guidance: guidance('Floors — cords'), fundingTags: ['general_repair'], helpRouting: familyReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'stair-clutter-check', concernId: 'stair-clutter-concern', evidenceId: 'stair-clutter-observation', roomId: 'stairs',
    prompt: 'Do objects obstruct the sample stairs?',
    observation: 'Scripted sample observation: a box occupies part of the stairs.',
    action: {
      nextStep: 'Clear everything off the stairs and keep the steps empty.', effort: 'quick_fix', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-stair-clutter', title: 'Review objects on the stairs',
      description: 'Discuss the documented stair obstruction and an appropriate next step with the resident.',
      source: syntheticSource, guidance: guidance('Stairs and steps — clutter'), fundingTags: ['general_repair'], helpRouting: familyReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'handrail-check', concernId: 'handrail-concern', evidenceId: 'handrail-observation', roomId: 'stairs',
    prompt: 'Is the sample stair handrail loose?',
    observation: 'Scripted sample observation: a stair handrail is described as loose.',
    action: {
      nextStep: 'Have a qualified professional fix the loose handrail. Handrails on both sides of the stairs help most.', effort: 'professional', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-handrail', title: 'Seek review of the stair handrail',
      description: 'Document the reported handrail concern and seek an appropriately qualified professional’s review.',
      source: syntheticSource, guidance: guidance('Stairs and steps — handrails'), fundingTags: ['railing'], helpRouting: professionalReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'stair-lighting-check', concernId: 'stair-lighting-concern', evidenceId: 'stair-lighting-observation', roomId: 'stairs',
    prompt: 'Is a light or accessible switch missing for the sample stairs?',
    observation: 'Scripted sample observation: the stairs lack a light and a switch at one end.',
    action: {
      nextStep: 'Ask an electrician to add a light with switches at the top and bottom of the stairs.', effort: 'professional', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-stair-lighting', title: 'Seek review of stair lighting',
      description: 'Discuss the documented stair-lighting concern and seek an appropriately qualified electrical professional’s review.',
      source: syntheticSource, guidance: guidance('Stairs and steps — lighting and switches'), fundingTags: ['lighting'], helpRouting: professionalReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'night-lighting-check', concernId: 'night-lighting-concern', evidenceId: 'night-lighting-observation', roomId: 'bedroom',
    prompt: 'Is the sample route from bed to bathroom dark?',
    observation: 'Scripted sample observation: the bed-to-bathroom route is described as dark at night.',
    action: {
      nextStep: 'Put a lamp within reach of the bed and plug in night-lights along the path to the bathroom.', effort: 'helper_task', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-night-lighting', title: 'Review the night walking route',
      description: 'Discuss visibility along the documented night route and an appropriate next step with the resident.',
      source: syntheticSource, guidance: guidance('Bedrooms — night path'), fundingTags: ['lighting'], helpRouting: familyReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'shower-surface-check', concernId: 'shower-surface-concern', evidenceId: 'shower-surface-observation', roomId: 'bathroom',
    prompt: 'Is the sample shower surface described as slippery?',
    observation: 'Scripted sample observation: the shower floor is described as slippery.',
    action: {
      nextStep: 'Put a non-slip rubber mat or self-stick strips on the tub or shower floor.', effort: 'helper_task', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-shower-surface', title: 'Review the shower surface',
      description: 'Discuss the documented shower-surface concern and whether appropriate advice is needed for a next step.',
      source: syntheticSource, guidance: guidance('Bathrooms — slippery tub or shower'), fundingTags: ['general_repair'], helpRouting: familyReview, cost: unknownCost,
    },
  },
  {
    checklistId: 'bathroom-support-check', concernId: 'bathroom-support-concern', evidenceId: 'bathroom-support-observation', roomId: 'bathroom',
    prompt: 'Is support reported as missing where needed near the sample tub or toilet?',
    observation: 'Scripted sample observation: support is reported as missing near the tub and toilet.',
    action: {
      nextStep: 'Have a qualified installer put grab bars next to and inside the tub and next to the toilet.', effort: 'professional', nextStepSource: 'Based on CDC 2017 Check for Safety',
      id: 'review-bathroom-support', title: 'Seek review of bathroom support',
      description: 'Document the reported support need and seek an appropriately qualified professional’s review before deciding on changes.',
      source: syntheticSource, guidance: guidance('Bathrooms — tub and toilet support'), fundingTags: ['bathroom_support'], helpRouting: professionalReview, cost: unknownCost,
    },
  },
];

export const demoScenario: DemoScenario = {
  id: 'fictional-maple-house', schemaVersion: 2, title: 'Fictional Maple House', synthetic: true,
  disclosure: 'All rooms, observations, assistance criteria, profiles, helpers, and requests are fictional sample data. No repairs, approvals, or external contacts have occurred.',
  rooms: [
    { id: 'living-room', name: 'Sample living room', photoUrl: null },
    { id: 'hallway', name: 'Sample hallway', photoUrl: null },
    { id: 'stairs', name: 'Sample stairs', photoUrl: null },
    { id: 'bedroom', name: 'Sample bedroom', photoUrl: null },
    { id: 'bathroom', name: 'Sample bathroom', photoUrl: null },
  ],
  checklist: samples.map((sample) => ({ id: sample.checklistId, roomId: sample.roomId, prompt: sample.prompt, referenceActionId: sample.action.id })),
  evidence: samples.map((sample) => ({ id: sample.evidenceId, roomId: sample.roomId, checklistItemId: sample.checklistId, observation: sample.observation, imageUrl: null, source: syntheticSource })),
  concerns: samples.map((sample) => ({ id: sample.concernId, evidenceIds: [sample.evidenceId], referenceActionId: sample.action.id, confirmation: { humanConfirmed: false, confirmedBy: null, confirmedAt: null } })),
  referenceActions: samples.map((sample) => sample.action),
  factDefinitions, profiles: fictionalProfiles,
  programs: [
    {
      id: 'fictional-maple-support', name: 'FICTIONAL Maple Home Support Demo Program', fictional: true,
      description: 'An invented record for exercising the demo. This program does not exist.', source: syntheticSource, contact: null,
      rule: { id: 'support-rules', label: 'All fictional support conditions', op: 'all', children: [
        { id: 'support-area', label: 'Fictional Maple service area', op: 'eq', factId: 'area', value: 'maple' },
        { id: 'support-age', label: 'Fictional age threshold', op: 'gte', factId: 'ageYears', value: 65 },
        { id: 'support-income', label: 'Fictional income limit', op: 'lte', factId: 'annualIncomeUsd', value: 30000 },
        { id: 'support-owner', label: 'Fictional homeowner condition', op: 'eq', factId: 'homeowner', value: true },
      ] },
      coverageTags: ['general_repair', 'railing', 'bathroom_support'],
      unmodeledRequirements: ['Documentation, property permissions and any detailed work review are not modeled.', 'No real program availability, application process or award decision is represented.'],
    },
    {
      id: 'fictional-maple-lighting', name: 'FICTIONAL Maple Lighting Demo Program', fictional: true,
      description: 'A second invented record for exercising the demo. This program does not exist.', source: syntheticSource, contact: null,
      rule: { id: 'lighting-rules', label: 'All fictional lighting conditions', op: 'all', children: [
        { id: 'lighting-area', label: 'Fictional Maple service area', op: 'eq', factId: 'area', value: 'maple' },
        { id: 'lighting-income', label: 'Fictional income limit', op: 'lte', factId: 'annualIncomeUsd', value: 45000 },
        { id: 'lighting-connection', label: 'At least one fictional connection', op: 'any', children: [
          { id: 'lighting-owner', label: 'Fictional homeowner condition', op: 'eq', factId: 'homeowner', value: true },
          { id: 'lighting-resident', label: 'Fictional resident condition', op: 'eq', factId: 'resident', value: true },
        ] },
      ] },
      coverageTags: ['lighting'],
      unmodeledRequirements: ['Landlord permissions, documentation and detailed electrical review are not modeled.', 'No real program availability, application process or award decision is represented.'],
    },
  ],
  localHelpResources,
  requests: [],
};

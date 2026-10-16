import type { DemoScenario, SourceRecord } from '../domain/types';

const syntheticSource = {
  status: 'synthetic',
  label: 'Authored fictional fixture for the FixList demo',
  citationUrl: null,
  verifiedAt: null,
} satisfies SourceRecord;

export const demoScenario = {
  id: 'fictional-maple-house',
  schemaVersion: 1,
  title: 'Fictional Maple House',
  synthetic: true,
  disclosure:
    'All rooms, observations, assistance criteria, helpers, and requests are fictional sample data. No repairs, approvals, or external contacts have occurred.',
  rooms: [
    { id: 'living-room', name: 'Sample living room', photoUrl: null },
    { id: 'hallway', name: 'Sample hallway', photoUrl: null },
  ],
  checklist: [
    {
      id: 'rug-check',
      prompt: 'Does a rug edge obstruct the walking route?',
      referenceActionId: 'review-rug',
    },
    {
      id: 'cord-check',
      prompt: 'Does a cord cross the walking route?',
      referenceActionId: 'review-cord',
    },
  ],
  evidence: [
    {
      id: 'rug-observation',
      roomId: 'living-room',
      checklistItemId: 'rug-check',
      observation: 'Scripted sample observation: a rug edge crosses the walkway.',
      imageUrl: null,
      source: syntheticSource,
    },
    {
      id: 'cord-observation',
      roomId: 'hallway',
      checklistItemId: 'cord-check',
      observation: 'Scripted sample observation: a lamp cord crosses the hallway.',
      imageUrl: null,
      source: syntheticSource,
    },
  ],
  concerns: [
    {
      id: 'rug-concern',
      evidenceIds: ['rug-observation'],
      referenceActionId: 'review-rug',
      confirmation: { humanConfirmed: false, confirmedBy: null, confirmedAt: null },
    },
    {
      id: 'cord-concern',
      evidenceIds: ['cord-observation'],
      referenceActionId: 'review-cord',
      confirmation: { humanConfirmed: false, confirmedBy: null, confirmedAt: null },
    },
  ],
  referenceActions: [
    {
      id: 'review-rug',
      title: 'Review the rug placement',
      description:
        'Demo reference text: discuss the documented obstruction with the resident before deciding on an action.',
      source: syntheticSource,
    },
    {
      id: 'review-cord',
      title: 'Review the cord route',
      description:
        'Demo reference text: document the cord route and agree on a next step with the resident.',
      source: syntheticSource,
    },
  ],
  programs: [
    {
      id: 'fictional-maple-support',
      name: 'FICTIONAL Maple Home Support Demo Program',
      fictional: true,
      description: 'An invented record for exercising the demo. This program does not exist.',
      source: syntheticSource,
      contact: null,
      criteria: [
        {
          id: 'fictional-area',
          description: 'Lives in the fictional Maple service area',
          status: 'met',
          answerNote: 'Scripted sample answer only.',
        },
        {
          id: 'fictional-residency',
          description: 'Has answered the fictional residency question',
          status: 'unknown',
          answerNote: 'No answer supplied; the future engine must preserve this unknown.',
        },
      ],
    },
  ],
  requests: [
    {
      id: 'sample-family-draft',
      referenceActionId: 'review-rug',
      helperLabel: 'Fictional family-known helper',
      recordedBy: 'Fictional family member',
      status: 'draft',
      note: 'A scripted draft only. Nothing has been sent and no work is reported complete.',
      completion: { status: 'unconfirmed', reportedBy: null, reportedAt: null },
      source: syntheticSource,
    },
  ],
} satisfies DemoScenario;

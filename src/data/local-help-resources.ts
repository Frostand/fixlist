import type { LocalHelpResource } from '../domain/types';

export const localHelpResources: readonly LocalHelpResource[] = [{
  id: 'eldercare-locator', name: 'Eldercare Locator',
  description: 'A public service of the U.S. Administration for Community Living that connects older adults and families to local services, including Area Agencies on Aging.',
  url: 'https://eldercare.acl.gov/', phone: '1-800-677-1116',
  source: { status: 'verified', label: 'U.S. Administration for Community Living', verifiedAt: '2026-10-18', citationUrl: 'https://eldercare.acl.gov/' },
}];

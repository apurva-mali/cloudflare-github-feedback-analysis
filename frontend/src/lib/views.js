import { inInbox } from './format.js';

// Quick views. Dismissed (off-topic, duplicates…) is hidden everywhere else.
export const VIEWS = {
  all: { label: 'All', test: (i) => i.status !== 'Dismissed' },
  review: { label: 'To review', test: inInbox },
  starred: { label: 'Starred', test: (i) => i.starred && i.status !== 'Dismissed' },
  dismissed: { label: 'Dismissed', test: (i) => i.status === 'Dismissed' },
};

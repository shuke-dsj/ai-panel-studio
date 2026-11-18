import { readFileSync } from 'node:fs';
import type { Snapshot } from '../shared/types.js';
import type { Store } from './db.js';

const archiveNames = [
  'knowledge-base-pilot',
  'microservices',
  'ai-code-review',
  'subscription',
  'customer-support',
];

export function seedReviewedExamples(store: Store) {
  for (const name of archiveNames) {
    const archive: Omit<Snapshot, 'activities' | 'cursor'> = JSON.parse(
      readFileSync(new URL(`./examples/${name}.json`, import.meta.url), 'utf8'),
    );
    store.seedArchive(archive);
  }
}

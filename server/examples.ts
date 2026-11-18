import { readFileSync } from 'node:fs';
import type { Snapshot } from '../shared/types.js';
import type { Store } from './db.js';

export function seedReviewedExamples(store: Store) {
  const archive: Omit<Snapshot, 'activities' | 'cursor'> = JSON.parse(
    readFileSync(new URL('./examples/knowledge-base-pilot.json', import.meta.url), 'utf8'),
  );
  store.seedArchive(archive);
}

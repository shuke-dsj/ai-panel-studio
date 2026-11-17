import { describe,it,expect } from 'vitest';
import { applyEvent } from '../src/lib/usePanel.js';
import { Store } from '../server/db.js';
describe('client event recovery',()=>{
 it('deduplicates replayed events and ignores foreign or old cursor data',()=>{const store=new Store(':memory:');const d=store.create('test',2,6);const s=store.snapshot(d.id);store.update(d.id,{status:'generating'});const e=store.events(d.id,0)[0];const updated=applyEvent(s,e);expect(updated.discussion.status).toBe('generating');expect(applyEvent(updated,e)).toBe(updated);expect(applyEvent(updated,{...e,seq:e.seq+1,discussionId:'foreign'})).toBe(updated);store.close();});
});

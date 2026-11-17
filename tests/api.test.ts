import { describe,it,expect } from 'vitest';
import { createApp } from '../server/app.js';
import { Store } from '../server/db.js';
import { DemoModel } from '../server/demo-model.js';
describe('API contracts',()=>{
 it('validates inputs, blocks foreign origins, handles not-found and idempotent commands',async()=>{
  const store=new Store(':memory:');const {app,engine}=await createApp(store,new DemoModel(0));
  expect((await app.inject({method:'POST',url:'/api/discussions',payload:{topic:' ',expertCount:8,maxTurns:3}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:'/api/discussions',headers:{origin:'https://evil.example'},payload:{topic:'test'}})).statusCode).toBe(403);
  expect((await app.inject('/api/discussions/missing')).statusCode).toBe(404);
  const created=await app.inject({method:'POST',url:'/api/discussions',payload:{topic:'测试评审',expertCount:2,maxTurns:6}});expect(created.statusCode).toBe(201);const id=created.json().id;
  expect((await app.inject({method:'POST',url:`/api/discussions/${id}/start`})).statusCode).toBe(409);
  for(const action of ['roster','confirm','confirm','start','start'])expect((await app.inject({method:'POST',url:`/api/discussions/${id}/${action}`})).statusCode).toBe(200);
  await engine.wait(id);const s=(await app.inject(`/api/discussions/${id}`)).json();expect(s.discussion.status).toBe('completed');expect(s.discussion.turns).toBe(6);expect(s.cursor).toBeGreaterThan(0);expect(JSON.stringify(s)).not.toContain('publicReason');await app.close();store.close();
 });
 it('replays strictly ordered persisted events after a supplied cursor',async()=>{const store=new Store(':memory:');const d=store.create('test',2,6);store.update(d.id,{status:'generating'});const first=store.cursor(d.id);store.update(d.id,{status:'draft'});const events=store.events(d.id,first);expect(events).toHaveLength(1);expect(events[0].seq).toBe(first+1);expect(store.events(d.id,events[0].seq)).toEqual([]);store.close();});
});

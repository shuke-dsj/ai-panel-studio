import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { createSchema } from './schemas.js';
import { ModelError,type Model } from './model.js';
import { Store } from './db.js';
import { Engine } from './engine.js';
import type { PanelEvent } from '../shared/types.js';

export async function createApp(store:Store,model:Model,options:{contextBudget?:number;serveStatic?:boolean}={}){
  const app=Fastify({logger:false,bodyLimit:16384});const engine=new Engine(store,model,options.contextBudget);
  store.recover();
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin');
    // Local-only mutation protection: no permissive CORS and reject cross-origin writes.
    if(request.method==='POST'){
      const origin=request.headers.origin;
      if(request.headers['sec-fetch-site']==='cross-site'||(origin&&!['http://127.0.0.1:5173','http://localhost:5173',`http://${request.headers.host}`].includes(origin)))return reply.code(403).send({error:'仅允许本地应用发起操作。'});
    }
  });
  app.setErrorHandler((error,_request,reply)=>{
    const status=error instanceof ZodError?400:error instanceof ModelError?503:(error as {statusCode?:number}).statusCode??500;
    const message=error instanceof ZodError?'输入不符合要求：话题 1–2000 字，专家 2–6 人，发言 6–20 次。':(status<500||error instanceof ModelError)&&error instanceof Error?error.message:'服务器步骤未完成，请重试。';
    reply.code(status).send({error:message});
  });
  app.get('/api/health',async()=>({ok:true,mode:model.mode,configured:model.configured}));
  app.get('/api/discussions',async()=>store.list());
  app.post('/api/discussions',async(request,reply)=>{const v=createSchema.parse(request.body);return reply.code(201).send(store.create(v.topic,v.expertCount,v.maxTurns,model.mode==='demo'?'test':'live'));});
  app.get<{Params:{id:string}}>('/api/discussions/:id',async request=>store.snapshot(request.params.id));
  app.post<{Params:{id:string}}>('/api/discussions/:id/roster',async request=>{await engine.generate(request.params.id);return store.snapshot(request.params.id);});
  for(const action of ['confirm','start','resume','pause','end'] as const){
    app.post<{Params:{id:string}}>(`/api/discussions/:id/${action}`,async request=>{const id=request.params.id;if(action==='confirm')engine.confirm(id);else if(action==='start'||action==='resume')engine.start(id);else if(action==='pause')engine.pause(id);else engine.end(id);return store.snapshot(id);});
  }
  app.get<{Params:{id:string};Querystring:{after?:string}}>('/api/discussions/:id/events',async(request,reply)=>{
    const id=request.params.id;store.get(id);
    const raw=request.headers['last-event-id']??request.query.after??'0';const after=Number(raw);
    if(!Number.isSafeInteger(after)||after<0)return reply.code(400).send({error:'无效事件游标。'});
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const send=(e:PanelEvent)=>reply.raw.write(`id: ${e.seq}\nevent: update\ndata: ${JSON.stringify(e)}\n\n`);
    // Registration and replay are synchronous: no event can slip between them.
    for(const event of store.events(id,after))send(event);
    store.bus.on(id,send);reply.raw.write(': connected\n\n');
    const heartbeat=setInterval(()=>reply.raw.write(': heartbeat\n\n'),15000);
    reply.raw.on('close',()=>{clearInterval(heartbeat);store.bus.off(id,send);});
  });
  if(options.serveStatic&&existsSync(resolve('dist/index.html'))){await app.register(staticPlugin,{root:resolve('dist')});app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'接口不存在。'}):reply.sendFile('index.html'));}
  return {app,engine};
}

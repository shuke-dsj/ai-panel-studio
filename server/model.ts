import type { ZodType } from 'zod';
import { prompts, type Task } from './prompts.js';
export interface Model { run<T>(task:Task,input:unknown,schema:ZodType<T>):Promise<T>; mode:'real'|'demo'; configured:boolean; }
export class ModelError extends Error { constructor(public code:string,message:string){super(message);this.name='ModelError';} }
export class RealModel implements Model {
  mode='real' as const;
  configured:boolean;
  private active=0;
  private waiting:(()=>void)[]=[];
  constructor(private config:{key:string;baseUrl:string;model:string;timeout?:number;maxTokens?:number;concurrency?:number;fetcher?:typeof fetch;logger?:(entry:unknown)=>void}) {this.configured=!!(config.key&&config.baseUrl&&config.model);}
  private async acquire() { const limit=this.config.concurrency??3; if(this.active>=limit) await new Promise<void>(resolve=>this.waiting.push(resolve)); else this.active++; }
  private release() {const next=this.waiting.shift();if(next)next();else this.active--;}
  async run<T>(task:Task,input:unknown,schema:ZodType<T>):Promise<T>{
    if(!this.configured) throw new ModelError('NOT_CONFIGURED','真实模型尚未配置。请在后端 .env 设置 MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME，再重启服务。');
    await this.acquire();
    try {
      for(let attempt=0;attempt<2;attempt++) {
        const started=Date.now();
        try {
          const response=await (this.config.fetcher??fetch)(`${this.config.baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.config.key}`},signal:AbortSignal.timeout(this.config.timeout??60000),body:JSON.stringify({model:this.config.model,messages:[{role:'system',content:prompts[task]},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_object'},max_tokens:this.config.maxTokens??4000,stream:false})});
          if(!response.ok) throw new ModelError(`HTTP_${response.status}`,`模型服务返回 HTTP ${response.status}。请检查账户、模型权限或服务状态。`);
          const body=await response.json() as {choices?:{message?:{content?:string}}[];usage?:unknown};
          const content=body.choices?.[0]?.message?.content;
          if(!content?.trim()) throw new ModelError('EMPTY','模型没有返回有效正文。');
          const output=schema.parse(JSON.parse(content));
          this.config.logger?.({task,attempt,durationMs:Date.now()-started,usage:body.usage});return output;
        } catch(error) {
          const code=error instanceof ModelError?error.code:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':'INVALID_OUTPUT';
          this.config.logger?.({task,attempt,durationMs:Date.now()-started,error:code});
          if(attempt===1) throw error instanceof ModelError?error:new ModelError(code,code==='TIMEOUT'?'模型请求超时，已重试一次。请稍后重试。':'模型返回格式无效，已重试一次。请重试或更换支持 JSON 输出的模型。');
        }
      }
      throw new ModelError('UNKNOWN','模型调用未完成。');
    } finally {this.release();}
  }
}

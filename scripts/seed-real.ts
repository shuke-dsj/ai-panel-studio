import { Store } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { configuredModel,settings } from '../server/config.js';
import { examples } from '../server/seed.js';
const model=configuredModel(true);
if(!model.configured){console.error('真实模型未配置；未生成或伪造真实示例。请先运行 npm run model:probe。');process.exitCode=1;}
else {
 const store=new Store(settings.database);const engine=new Engine(store,model,settings.contextBudget);
 try{for(const example of examples){const d=store.create(example.topic,4,12,'real-example');console.info(`Generating real example: ${d.id} ${d.topic}`);await engine.generate(d.id);engine.confirm(d.id);engine.start(d.id);await engine.wait(d.id);if(store.get(d.id).status!=='completed')throw new Error(`示例未完成：${d.id}。保留现场供重试。`);console.info(`Generated ${d.id}. Human review is still required before submission.`);}}
 catch(error){console.error(error instanceof Error?error.message:'Seed failed');process.exitCode=1;}finally{store.close();}
}

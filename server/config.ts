import 'dotenv/config';
import { RealModel } from './model.js';
import { DemoModel } from './demo-model.js';
const number = (key: string, value: number, min: number, max: number) => {
  const raw = Number(process.env[key] ?? value);
  if (!Number.isFinite(raw) || raw < min || raw > max)
    throw new Error(`${key} 配置范围应为 ${min}–${max}`);
  return Math.floor(raw);
};
function thinkingMode(): 'enabled' | 'disabled' | undefined {
  const value = process.env.MODEL_THINKING;
  if (!value) return undefined;
  if (value !== 'enabled' && value !== 'disabled')
    throw new Error('MODEL_THINKING只能为enabled或disabled；不支持该参数的服务请留空。');
  return value;
}
export const settings = {
  port: number('PORT', 3001, 1024, 65535),
  database: process.env.DATABASE_PATH ?? './data/panel.sqlite',
  contextBudget: number('MODEL_CONTEXT_CHARS', 56000, 12000, 100000),
  timeout: number('MODEL_TIMEOUT_MS', 60000, 1000, 180000),
  maxTokens: number('MODEL_MAX_OUTPUT_TOKENS', 8000, 500, 16000),
  concurrency: number('MODEL_CONCURRENCY', 3, 1, 12),
  demoDelay: number('DEMO_DELAY_MS', 350, 0, 5000),
  thinking: thinkingMode(),
};
export function configuredModel(forceReal = false) {
  if (!forceReal && process.env.MODEL_MODE === 'demo') return new DemoModel(settings.demoDelay);
  if (process.env.MODEL_MODE && !['real', 'demo'].includes(process.env.MODEL_MODE))
    throw new Error('MODEL_MODE 只能为 real 或 demo');
  return new RealModel({
    key: process.env.MODEL_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.MODEL_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.MODEL_NAME ?? '',
    timeout: settings.timeout,
    maxTokens: settings.maxTokens,
    concurrency: settings.concurrency,
    thinking: settings.thinking,
    logger: (entry) => console.info(JSON.stringify({ modelCall: entry })),
  });
}

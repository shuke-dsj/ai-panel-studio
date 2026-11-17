import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('delivery', { recursive: true });
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) {
  console.error('请先审阅并提交当前源文件变更，再打包，避免遗漏。');
  process.exitCode = 1;
} else {
  execFileSync('git', [
    'archive',
    '--format=zip',
    '--output=delivery/ai-panel-studio-source.zip',
    'HEAD',
  ]);
  console.info(
    'Created delivery/ai-panel-studio-source.zip from committed HEAD. Credentials and runtime data are excluded.',
  );
}

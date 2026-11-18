import { useId } from 'react';
import type { DiscussionUsage as Usage } from '../../shared/types';

const tokens = new Intl.NumberFormat('zh-CN');
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

export function DiscussionUsage({ usage }: { usage?: Usage }) {
  const panelId = useId();
  const hit = usage?.cacheHitTokens ?? 0;
  const cacheTotal = hit + (usage?.cacheMissTokens ?? 0);
  const rate = cacheTotal > 0 ? percent.format(hit / cacheTotal) : '—';
  const fields = [
    ['输入', usage?.inputTokens, usage?.inputReports],
    ['输出', usage?.outputTokens, usage?.outputReports],
    ['缓存命中', usage?.cacheHitTokens, usage?.cacheReports],
    ['缓存未命中', usage?.cacheMissTokens, usage?.cacheReports],
  ] as const;
  return (
    <div className="discussion-usage">
      <button type="button" popoverTarget={panelId} aria-label="查看 Token 用量">
        Token · <span className="usage-rate">命中 {rate}</span>
      </button>
      <div id={panelId} popover="auto" className="usage-popover" aria-label="本场 Token 用量">
        <div className="usage-heading">
          <strong>本场 Token 用量</strong>
          <button
            type="button"
            popoverTarget={panelId}
            popoverTargetAction="hide"
            aria-label="关闭 Token 用量"
          >
            ×
          </button>
        </div>
        <dl>
          {fields.map(([label, count, reports]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {count === undefined ? '—' : tokens.format(count)}
                {usage && reports !== undefined && reports > 0 && reports < usage.attempts
                  ? '（部分）'
                  : ''}
              </dd>
            </div>
          ))}
          <div>
            <dt>缓存命中率</dt>
            <dd>{rate}</dd>
          </div>
        </dl>
        <p>
          {usage
            ? `上线后累计 ${usage.attempts} 次请求尝试，${usage.cacheReports} 次有完整缓存数据。命中率按已知缓存 Token 计算。`
            : '暂无用量数据。旧记录和演示场次可能没有统计。'}
        </p>
      </div>
    </div>
  );
}

import type { Discussion, DiscussionLimits, EndReason } from '../shared/types.js';
import { ModelError } from './model.js';
export const limitsFor = (d: Discussion): DiscussionLimits =>
  d.limits ?? makeLimits(d.expertCount, d.maxTurns);
export function makeLimits(
  experts: number,
  maxTurns: number,
  overrides: Partial<DiscussionLimits> = {},
): DiscussionLimits {
  return {
    minTurns: Math.min(maxTurns, experts * 2 + 2),
    maxModelCalls: maxTurns <= 6 ? 96 : maxTurns <= 48 ? 360 : 720,
    maxActiveMs: (maxTurns <= 48 ? 25 : 45) * 60000,
    ...overrides,
  };
}
export const cycleTurns = (d: Discussion) => d.turns - (d.cycleStartTurns ?? 0);
export const activeElapsed = (d: Discussion, now = Date.now()) =>
  (d.activeMs ?? 0) + (d.runStartedAt ? Math.max(0, now - Date.parse(d.runStartedAt)) : 0);
export const clockStopped = (d: Discussion) => ({ activeMs: activeElapsed(d), runStartedAt: null });
export class DirectionChanged extends Error {
  constructor() {
    super('方向版本已更新，丢弃过期结果');
  }
}
export class BoundaryStop extends ModelError {
  constructor(public reason: Extract<EndReason, 'time_limit' | 'model_budget'>) {
    super(
      reason === 'time_limit' ? 'TIME_BUDGET' : 'MODEL_BUDGET',
      reason === 'time_limit' ? '本轮讨论已达到时间预算。' : '本轮讨论已达到模型调用预算。',
    );
  }
}

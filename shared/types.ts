export type Status =
  | 'draft'
  | 'generating'
  | 'roster_ready'
  | 'ready'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'ending'
  | 'summarizing'
  | 'completed'
  | 'error';
export type Phase = 'opening' | 'exploration' | 'exchange' | 'convergence' | 'closing';
export type Activity = { state: 'idle' | 'preparing' | 'speaking'; focus: string };
export type EndReason =
  | 'converged'
  | 'stable_disagreement'
  | 'stalled'
  | 'turn_limit'
  | 'time_limit'
  | 'model_budget'
  | 'user';
export type DirectionMode = 'focus' | 'replace';
export interface DiscussionLimits {
  minTurns: number;
  maxModelCalls: number;
  maxActiveMs: number;
}
export interface Participant {
  id: string;
  discussionId: string;
  role: 'moderator' | 'expert';
  name: string;
  occupation: string;
  title: string;
  stance: string;
  focus: string;
  color: string;
}
export interface Message {
  id: string;
  discussionId: string;
  participantId: string;
  seq: number;
  text: string;
  replyTo: string | null;
  addressedTo: string | null;
  phase: Phase;
  createdAt: string;
  kind?: 'speech' | 'direction';
  directionVersion?: number;
  directionMode?: DirectionMode;
  clientRequestId?: string;
}
export interface Insight {
  id: string;
  kind: 'consensus' | 'disagreement';
  text: string;
  messageIds: string[];
  positions: { participantId: string; view: string }[];
  question?: string;
  evidence?: InsightEvidence[];
}
export interface InsightEvidence {
  messageId: string;
  participantId: string;
  quote: string;
  stance: 'support' | 'oppose' | 'accept' | 'withdraw' | 'context';
  supportsClaim: boolean;
  view: string;
  seq: number;
}
export type IssueStatus = 'consensus' | 'disagreement' | 'question' | 'resolved' | 'merged';
export interface IssueRecord {
  id: string;
  question: string;
  text: string;
  status: IssueStatus;
  verified: boolean;
  requiredParticipantIds: string[];
  evidence: InsightEvidence[];
  aliases: string[];
  lastSeq: number;
  closedAtSeq?: number;
  mergedInto?: string;
  history: { status: IssueStatus; text: string; evidence: InsightEvidence[]; seq: number }[];
}
export interface InsightLedger {
  version: 1;
  records: IssueRecord[];
  audit: {
    seq: number;
    accepted: string[];
    closed: string[];
    reopened: string[];
    merged: string[];
    rejected: { issueId: string | null; reason: string }[];
  }[];
}
export interface EvidenceAnchor {
  id: string;
  messageId: string;
  participantId: string;
  seq: number;
  quote: string;
  kinds: ('scope' | 'timeline' | 'condition')[];
}
export interface EvidenceMemory {
  version: 1;
  anchors: EvidenceAnchor[];
}
export interface Discussion {
  id: string;
  topic: string;
  expertCount: number;
  maxTurns: number;
  turns: number;
  status: Status;
  phase: Phase;
  summary: string | null;
  contextSummary: string;
  evidenceMemory?: EvidenceMemory;
  insightLedger?: InsightLedger;
  effectiveTopic?: string;
  focus?: string;
  directionVersion?: number;
  boundaryStartSeq?: number;
  handledDirectionVersion?: number;
  rosterStale?: boolean;
  cycle?: number;
  cycleStartTurns?: number;
  cycleStartSeq?: number;
  directionStartTurns?: number;
  modelCalls?: number;
  activeMs?: number;
  runStartedAt?: string | null;
  lastMeterAt?: string;
  limits?: DiscussionLimits;
  endReason?: EndReason | null;
  summaryDetails?: string | null;
  summaryHistory?: {
    cycle: number;
    topic: string;
    summary: string;
    details: string | null;
    createdAt: string;
    revisionReason?: string;
  }[];
  previousContexts?: {
    version: number;
    topic: string;
    insights: Insight[];
    createdAt: string;
    ledger?: InsightLedger;
    reason?: string;
  }[];
  error: string | null;
  resumeStatus: 'running' | 'summarizing' | null;
  createdAt: string;
  updatedAt: string;
  source: 'live' | 'curated' | 'real-example' | 'test';
}
export interface Snapshot {
  discussion: Discussion;
  participants: Participant[];
  messages: Message[];
  insights: Insight[];
  activities: Record<string, Activity>;
  cursor: number;
}
export interface PanelEvent {
  discussionId: string;
  seq: number;
  type: 'status' | 'activity' | 'message' | 'insights' | 'completed' | 'error' | 'roster';
  data: unknown;
  createdAt: string;
}
export interface Intent {
  participantId: string;
  apply: boolean;
  kind: 'raise' | 'interrupt' | 'supplement' | 'rebuttal';
  replyTo: string | null;
  urgency: number;
  publicReason: string;
  directionVersion?: number;
  contextSeq?: number;
}
export const endReasonLabels: Record<EndReason, string> = {
  converged: '讨论收敛',
  stable_disagreement: '保留稳定分歧后收束',
  stalled: '缺少新信息，待进一步验证',
  turn_limit: '达到发言安全上限，尚不代表完全收敛',
  time_limit: '达到本轮时间预算',
  model_budget: '达到本轮调用预算',
  user: '用户结束讨论',
};
export const statusLabels: Record<Status, string> = {
  draft: '待生成阵容',
  generating: '生成阵容中',
  roster_ready: '待确认阵容',
  ready: '待开始',
  running: '讨论中',
  pausing: '正在暂停',
  paused: '已暂停',
  ending: '正在结束',
  summarizing: '总结中',
  completed: '已结束',
  error: '需要处理',
};
export const phaseLabels: Record<Phase, string> = {
  opening: '主持人开场',
  exploration: '观点展开',
  exchange: '交叉讨论',
  convergence: '收敛讨论',
  closing: '主持人总结',
};

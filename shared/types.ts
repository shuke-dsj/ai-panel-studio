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
}
export interface Insight {
  id: string;
  kind: 'consensus' | 'disagreement';
  text: string;
  messageIds: string[];
  positions: { participantId: string; view: string }[];
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
}
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

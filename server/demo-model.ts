import type { ZodType } from 'zod';
import type { Message, Participant } from '../shared/types.js';
import type { Model } from './model.js';
import type { Task } from './prompts.js';
// Explicit demonstration adapter. Never selected as a fallback.
export class DemoModel implements Model {
  mode = 'demo' as const;
  configured = true;
  constructor(private delay = 350) {}
  async run<T>(task: Task, input: unknown, schema: ZodType<T>): Promise<T> {
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
    const c = input as {
      topic: string;
      expertCount: number;
      current: Participant;
      participants: Participant[];
      messages: Message[];
      turns: number;
      phase: string;
      directive: string;
    };
    const profiles = [
      [
        '林远',
        '产品研究负责人',
        '圆桌主持人',
        '中立：澄清问题与决策条件',
        '需求澄清、观点对齐与结论收敛',
      ],
      [
        '周成',
        '资深产品经理',
        '业务价值顾问',
        '支持小范围试点，以真实价值验证方向',
        '用户价值、试点范围与验收指标',
      ],
      [
        '陈芷',
        'AI 应用架构师',
        '技术评审专家',
        '有条件支持，先定义可量化的效果标准',
        '技术可行性、评测与边界',
      ],
      [
        '王峻',
        '安全与合规顾问',
        '风险评审专家',
        '谨慎推进，先满足权限与审计前提',
        '数据安全、授权与风险控制',
      ],
      [
        '许澄',
        '平台运维负责人',
        '成本与交付顾问',
        '分阶段投入，设置明确成本上限',
        '总成本、稳定性与持续维护',
      ],
      ['沈乔', '用户研究员', '体验评审专家', '关注真实场景中的失败体验', '用户研究与失败回退'],
      ['陆衡', '组织发展顾问', '协作评审专家', '关注流程与责任边界', '组织协作、培训与责任'],
    ];
    let result: unknown;
    if (task === 'roster')
      result = {
        participants: profiles.slice(0, c.expertCount + 1).map((p, i) => ({
          role: i ? 'expert' : 'moderator',
          name: p[0],
          occupation: p[1],
          title: p[2],
          stance: p[3],
          focus: p[4],
        })),
      };
    else if (task === 'intent') {
      const index = c.participants.findIndex((p) => p.id === c.current.id);
      const last = c.messages.at(-1);
      result = {
        apply: true,
        kind:
          index === 3
            ? 'rebuttal'
            : index === 2
              ? 'supplement'
              : index === 4
                ? 'interrupt'
                : 'raise',
        replyTo: last?.id ?? null,
        urgency: index === 3 ? 3 : 1,
        publicReason: `希望从${c.current.focus}角度回应当前观点。`,
      };
    } else if (task === 'speech') {
      const index = c.participants.findIndex((p) => p.id === c.current.id);
      const last = c.messages.at(-1);
      const shared = '先设定可量化的试点验收标准';
      const lines = [
        `我们讨论“${c.topic}”。${c.directive} 请把建议拆成适用条件、可观察指标和退出条件，区分判断与需要验证的假设。`,
        `我建议把“${c.topic}”转成一个可验证的业务假设。${shared}，只选一个高频场景，比较任务完成率与人工处理时间。我的支持以试点收益能够覆盖新增投入为前提，尚不支持直接全面铺开。`,
        `补充技术视角：${shared}，并保留现有流程作为对照。对上一个观点，我赞同先验证，但要覆盖失败样本、人工接管和数据更新成本；平均表现良好不代表边界场景可用。`,
        `我对当前推进节奏仍持保留意见。${shared}只能回答效果问题，不能替代权限与审计验收。即使业务指标改善，也需要先检查越权访问和责任边界；安全条件未满足之前不应扩大范围。`,
        `从交付角度，我赞同先设定可量化的试点验收标准。对前面的方案还要补上持续维护、异常回退和预算上限。我们可以在隔离范围内做小规模验证，但是否扩展应取决于每个有效结果的总成本。`,
        `我想补充真实用户的失败体验。先设定可量化的试点验收标准，再观察用户遇到错误时能否识别问题、回到人工流程。访谈和任务观察应与指标一起使用，避免漂亮的平均值掩盖体验损失。`,
        `我关注谁负责验收和长期维护。先设定可量化的试点验收标准，还应确定负责人、复盘周期和退出条件。团队若没有持续维护能力，短期试点成功也不能证明可以全面推广。`,
      ];
      result = {
        text:
          lines[Math.max(0, index)] +
          (c.current.role === 'expert' && c.turns > 4
            ? ' 当前讨论已聚焦有条件试点，我建议把尚未解决的前提写入验收清单。'
            : ''),
        replyTo: last?.id ?? null,
        addressedTo:
          c.current.role === 'moderator'
            ? (c.participants.find((p) => p.role === 'expert')?.id ?? null)
            : null,
      };
    } else if (task === 'insights') {
      const expertIds = new Set(c.participants.filter((p) => p.role === 'expert').map((p) => p.id));
      const messages = c.messages.filter((m) => expertIds.has(m.participantId));
      const unique = [...new Map(messages.map((m) => [m.participantId, m])).values()];
      const evidence = unique
        .filter((m) => m.text.includes('先设定可量化的试点验收标准'))
        .map((m) => ({
          messageId: m.id,
          quote: '先设定可量化的试点验收标准',
          stance: 'support',
          view: '试点前明确可量化验收标准',
        }));
      const risky = unique.find((m) => m.text.includes('权限与审计验收'));
      const positive = unique.find((m) => m.text.includes('一个可验证的业务假设'));
      result = {
        progress: true,
        items: [
          ...(evidence.length >= 2
            ? [
                {
                  kind: 'consensus',
                  text: '先定义可量化的试点验收标准，再依据结果决定是否扩大范围。',
                  evidence,
                },
              ]
            : []),
          ...(risky && positive
            ? [
                {
                  kind: 'disagreement',
                  text: '试点启动前必须完成哪些风险控制，业务验证与安全验收应如何安排顺序？',
                  evidence: [
                    {
                      messageId: positive.id,
                      quote: '一个可验证的业务假设',
                      stance: 'support',
                      view: '支持受控的小范围业务验证',
                    },
                    {
                      messageId: risky.id,
                      quote: '不能替代权限与审计验收',
                      stance: 'oppose',
                      view: '扩大范围前必须满足安全条件',
                    },
                  ],
                },
              ]
            : []),
        ],
        contextSummary: `围绕${c.topic}讨论有条件试点、效果评估、安全前提和维护成本。已有${c.turns}次专家发言；尚未验证实际收益与安全边界。`,
      };
    } else
      result = {
        text: `关于“${c.topic}”，本场演示倾向于有条件的小范围验证。

已形成的共识：先定义可量化的验收标准，保留现有流程作对照，用实际结果决定是否扩大范围。

仍存在的分歧：业务试点与安全验收的先后顺序，以及哪些前提必须在试点前完成，尚未完全一致。安全、权限和维护能力都可能改变最终判断。

下一步：选定一个高频场景，指定负责人，明确预算、评测样本、人工回退和退出条件。验证真实收益及风险边界后再做扩展决策。

这是确定性演示数据，用于验证交互与工程链路，并非真实模型结论或已核实事实。`,
      };
    return schema.parse(result);
  }
}

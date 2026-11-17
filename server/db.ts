import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { extractEvidenceMemory } from './memory.js';
import {
  activeElapsed,
  cycleTurns,
  BoundaryStop,
  DirectionChanged,
  limitsFor,
  makeLimits,
  clockStopped,
} from './boundaries.js';
import type {
  Activity,
  Discussion,
  Insight,
  Intent,
  Message,
  PanelEvent,
  Participant,
  Snapshot,
  DirectionMode,
  DiscussionLimits,
} from '../shared/types.js';

export interface Checkpoint {
  queue: Intent[];
  pendingInsight: string | null;
  noProgress: number;
  roundActive?: boolean;
  roundProgress?: boolean;
  convergenceVotes?: number;
  lastConvergenceTurns?: number;
  completedRounds?: number;
}
const emptyCheckpoint = (): Checkpoint => ({ queue: [], pendingInsight: null, noProgress: 0 });
const parse = <T>(row: unknown): T => JSON.parse((row as { data: string }).data) as T;
export class Store {
  db: DatabaseSync;
  bus = new EventEmitter();
  constructor(path = './data/panel.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.bus.setMaxListeners(1000);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS discussions(id TEXT PRIMARY KEY, data TEXT NOT NULL, checkpoint TEXT NOT NULL, activities TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY, discussion_id TEXT NOT NULL REFERENCES discussions(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS participant_discussion ON participants(discussion_id);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, discussion_id TEXT NOT NULL REFERENCES discussions(id), seq INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(discussion_id,seq));
      CREATE TABLE IF NOT EXISTS insights(id TEXT NOT NULL, discussion_id TEXT NOT NULL REFERENCES discussions(id), data TEXT NOT NULL, PRIMARY KEY(discussion_id,id));
      CREATE TABLE IF NOT EXISTS events(discussion_id TEXT NOT NULL REFERENCES discussions(id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(discussion_id,seq));
      PRAGMA user_version=1;`);
  }
  close() {
    this.bus.removeAllListeners();
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  create(
    topic: string,
    expertCount: number,
    maxTurns: number,
    source: Discussion['source'] = 'live',
    limits: Partial<DiscussionLimits> = {},
  ): Discussion {
    const now = new Date().toISOString();
    const d: Discussion = {
      id: randomUUID(),
      topic,
      expertCount,
      maxTurns,
      turns: 0,
      status: 'draft',
      phase: 'opening',
      summary: null,
      contextSummary: '',
      evidenceMemory: { version: 1, anchors: [] },
      error: null,
      resumeStatus: null,
      createdAt: now,
      updatedAt: now,
      source,
      effectiveTopic: topic,
      focus: '',
      directionVersion: 0,
      boundaryStartSeq: 0,
      handledDirectionVersion: 0,
      rosterStale: false,
      cycle: 1,
      cycleStartTurns: 0,
      cycleStartSeq: 0,
      directionStartTurns: 0,
      modelCalls: 0,
      activeMs: 0,
      runStartedAt: null,
      limits: makeLimits(expertCount, maxTurns, limits),
      endReason: null,
      summaryDetails: null,
      summaryHistory: [],
      previousContexts: [],
    };
    this.db
      .prepare('INSERT INTO discussions(id,data,checkpoint) VALUES(?,?,?)')
      .run(d.id, JSON.stringify(d), JSON.stringify(emptyCheckpoint()));
    return d;
  }
  meterAttempt(id: string, version: number, count = true) {
    return this.transaction(() => {
      const d = this.get(id);
      if ((d.directionVersion ?? 0) !== version) throw new DirectionChanged();
      const limits = limitsFor(d);
      if (activeElapsed(d) >= limits.maxActiveMs) throw new BoundaryStop('time_limit');
      if (count) {
        if ((d.modelCalls ?? 0) >= limits.maxModelCalls) throw new BoundaryStop('model_budget');
        d.modelCalls = (d.modelCalls ?? 0) + 1;
      }
      d.lastMeterAt = new Date().toISOString();
      this.write(d);
      return d;
    });
  }
  steer(id: string, text: string, mode: DirectionMode, clientRequestId: string): Message {
    const existing = this.messages(id).find((m) => m.clientRequestId === clientRequestId);
    if (existing) return existing;
    let message!: Message;
    const events = this.transaction(() => {
      const d = this.get(id);
      const before = this.messages(id);
      const version = (d.directionVersion ?? 0) + 1;
      const now = new Date().toISOString();
      const renew =
        ['completed', 'ending', 'summarizing'].includes(d.status) ||
        cycleTurns(d) >= d.maxTurns ||
        (d.status === 'error' && d.resumeStatus === 'summarizing');
      if (d.summary) {
        d.summaryHistory = [
          ...(d.summaryHistory ?? []),
          {
            cycle: d.cycle ?? 1,
            topic: d.effectiveTopic ?? d.topic,
            summary: d.summary,
            details: d.summaryDetails ?? null,
            createdAt: now,
          },
        ];
      }
      if (renew) {
        d.cycle = (d.cycle ?? 1) + 1;
        d.cycleStartTurns = d.turns;
        d.cycleStartSeq = before.length + 1;
        d.modelCalls = 0;
        d.activeMs = 0;
        d.runStartedAt = null;
        d.status = 'paused';
      }
      if (mode === 'replace') {
        d.previousContexts = [
          ...(d.previousContexts ?? []),
          {
            version: d.directionVersion ?? 0,
            topic: d.effectiveTopic ?? d.topic,
            insights: this.insights(id),
            createdAt: now,
          },
        ];
        d.effectiveTopic = text;
        d.focus = '';
        d.boundaryStartSeq = before.length + 1;
        d.contextSummary = '用户已更新前提；旧条件只作历史，不能覆盖当前用户前提。';
        this.db.prepare('DELETE FROM insights WHERE discussion_id=?').run(id);
        if (['draft', 'generating', 'roster_ready', 'ready'].includes(d.status)) {
          if (d.status !== 'generating' && this.participants(id).length) d.status = 'roster_ready';
          d.rosterStale = true;
        }
      } else d.focus = text;
      d.directionVersion = version;
      d.directionStartTurns = d.turns;
      d.summary = null;
      d.summaryDetails = null;
      d.endReason = null;
      d.error = null;
      d.resumeStatus = null;
      message = {
        id: randomUUID(),
        discussionId: id,
        participantId: 'user',
        seq: before.length + 1,
        text,
        replyTo: null,
        addressedTo: null,
        phase: d.phase,
        createdAt: now,
        kind: 'direction',
        directionVersion: version,
        directionMode: mode,
        clientRequestId,
      };
      this.db
        .prepare('INSERT INTO messages VALUES(?,?,?,?)')
        .run(message.id, id, message.seq, JSON.stringify(message));
      d.evidenceMemory = extractEvidenceMemory(
        [...before, message].filter((m) => m.seq >= (d.boundaryStartSeq ?? 0)),
      );
      this.setCheckpoint(id, {
        ...emptyCheckpoint(),
        pendingInsight: mode === 'focus' && !renew ? this.checkpoint(id).pendingInsight : null,
      });
      this.db.prepare("UPDATE discussions SET activities='{}' WHERE id=?").run(id);
      this.write(d);
      return [
        this.insertEvent(id, 'message', message),
        this.insertEvent(id, 'insights', this.insights(id)),
        this.insertEvent(id, 'status', d),
      ];
    });
    for (const event of events) this.bus.emit(id, event);
    return message;
  }
  list(): Discussion[] {
    return this.db
      .prepare('SELECT data FROM discussions')
      .all()
      .map((row) => parse<Discussion>(row))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string): Discussion {
    const row = this.db.prepare('SELECT data FROM discussions WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('讨论不存在'), { statusCode: 404 });
    return parse<Discussion>(row);
  }
  checkpoint(id: string): Checkpoint {
    this.get(id);
    return JSON.parse(
      (
        this.db.prepare('SELECT checkpoint FROM discussions WHERE id=?').get(id) as {
          checkpoint: string;
        }
      ).checkpoint,
    );
  }
  setCheckpoint(id: string, cp: Checkpoint) {
    this.db.prepare('UPDATE discussions SET checkpoint=? WHERE id=?').run(JSON.stringify(cp), id);
  }
  private write(d: Discussion) {
    d.updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE discussions SET data=? WHERE id=?').run(JSON.stringify(d), d.id);
  }
  private insertEvent(id: string, type: PanelEvent['type'], data: unknown): PanelEvent {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE discussion_id=?')
      .get(id) as { seq: number };
    const e: PanelEvent = {
      discussionId: id,
      seq: row.seq,
      type,
      data,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(id, e.seq, JSON.stringify(e));
    return e;
  }
  update(id: string, changes: Partial<Discussion>, type: PanelEvent['type'] = 'status') {
    const e = this.transaction(() => {
      const d = { ...this.get(id), ...changes, id };
      this.write(d);
      return this.insertEvent(id, type, d);
    });
    this.bus.emit(id, e);
    return this.get(id);
  }
  activity(id: string, participantId: string, activity: Activity) {
    const e = this.transaction(() => {
      const all = this.activities(id);
      all[participantId] = activity;
      this.db
        .prepare('UPDATE discussions SET activities=? WHERE id=?')
        .run(JSON.stringify(all), id);
      return this.insertEvent(id, 'activity', { participantId, ...activity });
    });
    this.bus.emit(id, e);
  }
  resetActivities(id: string) {
    for (const p of this.participants(id))
      this.activity(id, p.id, { state: 'idle', focus: p.focus });
  }
  activities(id: string): Record<string, Activity> {
    return JSON.parse(
      (
        this.db.prepare('SELECT activities FROM discussions WHERE id=?').get(id) as {
          activities: string;
        }
      ).activities,
    );
  }
  participants(id: string): Participant[] {
    return this.db
      .prepare('SELECT data FROM participants WHERE discussion_id=? ORDER BY rowid')
      .all(id)
      .map((row) => parse<Participant>(row));
  }
  roster(id: string, people: Participant[]) {
    const e = this.transaction(() => {
      this.db.prepare('DELETE FROM participants WHERE discussion_id=?').run(id);
      for (const p of people)
        this.db.prepare('INSERT INTO participants VALUES(?,?,?)').run(p.id, id, JSON.stringify(p));
      const d = this.get(id);
      d.status = 'roster_ready';
      d.error = null;
      d.rosterStale = false;
      this.write(d);
      this.db.prepare("UPDATE discussions SET activities='{}' WHERE id=?").run(id);
      return this.insertEvent(id, 'roster', people);
    });
    this.bus.emit(id, e);
  }
  messages(id: string): Message[] {
    return this.db
      .prepare('SELECT data FROM messages WHERE discussion_id=? ORDER BY seq')
      .all(id)
      .map((row) => parse<Message>(row));
  }
  message(
    id: string,
    fields: Omit<Message, 'id' | 'discussionId' | 'seq' | 'createdAt'>,
    cp?: Checkpoint,
    expectedVersion?: number,
  ): Message {
    let message!: Message;
    const e = this.transaction(() => {
      const d = this.get(id);
      if (expectedVersion !== undefined && (d.directionVersion ?? 0) !== expectedVersion)
        throw new DirectionChanged();
      const rows = this.messages(id);
      const participant = this.participants(id).find((p) => p.id === fields.participantId);
      if (!participant) throw new Error('无效发言人');
      message = {
        ...fields,
        id: randomUUID(),
        discussionId: id,
        seq: rows.length + 1,
        createdAt: new Date().toISOString(),
      };
      this.db
        .prepare('INSERT INTO messages VALUES(?,?,?,?)')
        .run(message.id, id, message.seq, JSON.stringify(message));
      if (participant.role === 'expert') d.turns++;
      d.evidenceMemory = extractEvidenceMemory(
        [...rows, message].filter((m) => m.seq >= (d.boundaryStartSeq ?? 0)),
      );
      this.write(d);
      if (cp) {
        if (participant.role === 'expert') cp.pendingInsight = message.id;
        this.setCheckpoint(id, cp);
      }
      return this.insertEvent(id, 'message', message);
    });
    this.bus.emit(id, e);
    return message;
  }
  insights(id: string): Insight[] {
    return this.db
      .prepare('SELECT data FROM insights WHERE discussion_id=? ORDER BY rowid')
      .all(id)
      .map((row) => parse<Insight>(row));
  }
  replaceInsights(id: string, insights: Insight[], contextSummary: string, cp?: Checkpoint) {
    const e = this.transaction(() => {
      this.db.prepare('DELETE FROM insights WHERE discussion_id=?').run(id);
      for (const item of insights)
        this.db
          .prepare('INSERT INTO insights VALUES(?,?,?)')
          .run(item.id, id, JSON.stringify(item));
      const d = this.get(id);
      d.contextSummary = contextSummary;
      this.write(d);
      if (cp) this.setCheckpoint(id, cp);
      return this.insertEvent(id, 'insights', insights);
    });
    this.bus.emit(id, e);
  }
  cursor(id: string): number {
    return (
      this.db
        .prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE discussion_id=?')
        .get(id) as { seq: number }
    ).seq;
  }
  events(id: string, after: number): PanelEvent[] {
    return this.db
      .prepare('SELECT data FROM events WHERE discussion_id=? AND seq>? ORDER BY seq')
      .all(id, after)
      .map((row) => parse<PanelEvent>(row));
  }
  snapshot(id: string): Snapshot {
    return {
      discussion: this.get(id),
      participants: this.participants(id),
      messages: this.messages(id),
      insights: this.insights(id),
      activities: this.activities(id),
      cursor: this.cursor(id),
    };
  }
  recover() {
    for (const d of this.list()) {
      if (d.status === 'generating')
        this.update(d.id, {
          status: this.participants(d.id).length ? 'roster_ready' : 'draft',
          error: '服务重启，请重新生成阵容。',
        });
      else if (
        ['running', 'pausing', 'paused', 'ending', 'summarizing', 'error'].includes(d.status)
      ) {
        if (['running', 'pausing', 'ending', 'summarizing'].includes(d.status))
          this.update(d.id, {
            status: 'paused',
            resumeStatus: ['ending', 'summarizing'].includes(d.status)
              ? 'summarizing'
              : (d.resumeStatus ?? 'running'),
            error: '服务已重启，点击继续恢复讨论。',
            activeMs:
              (d.activeMs ?? 0) +
              (d.runStartedAt
                ? Math.max(
                    0,
                    Date.parse(d.lastMeterAt ?? d.runStartedAt) - Date.parse(d.runStartedAt),
                  )
                : 0),
            runStartedAt: null,
          });
        this.resetActivities(d.id);
      }
    }
  }
}

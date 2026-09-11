import type { RunEvent } from '@shared/types';

/**
 * Turns one Claude `stream-json` message into zero or more RunEvents.
 *
 * Pure over the message object (both the CLI and SDK drivers feed it), but stateful across calls:
 * it remembers which subagent type each task has and which Agent tool call spawned it, so tool
 * calls and results made inside the subagent (which carry only `parent_tool_use_id`) can be
 * attributed to the right agent. It never throws: anything malformed yields `[]`.
 *
 * `now` supplies `at` for every event (Date.now in main; a constant in tests).
 */
export function createNormaliser(now: () => number): (msg: unknown) => RunEvent[] {
  /** task_id -> subagent_type, from task_started. */
  const typeByTask = new Map<string, string>();
  /** tool_use_id of the Agent call -> task_id, from task_started. */
  const taskByToolUse = new Map<string, string>();
  /**
   * task_ids that already emitted agent:stop. Both task_notification and task_updated can signal
   * the end of a task and the recorded stream has task_updated first, so whichever arrives first
   * emits the stop and the other is dropped.
   */
  const stopped = new Set<string>();

  return (msg: unknown): RunEvent[] => {
    try {
      if (!isRecord(msg)) return [];
      const at = now();
      switch (msg.type) {
        case 'system':
          return fromSystem(msg, at);
        case 'assistant':
          return fromAssistant(msg, at);
        case 'user':
          return fromUser(msg, at);
        case 'rate_limit_event':
          return fromRateLimit(msg, at);
        case 'result':
          return [fromResult(msg, at)];
        default:
          return [];
      }
    } catch {
      return [];
    }
  };

  function fromSystem(msg: Rec, at: number): RunEvent[] {
    switch (msg.subtype) {
      case 'init':
        return [{
          t: 'init',
          sessionId: str(msg.session_id),
          plugins: pluginNames(msg.plugins),
          skills: strings(msg.skills),
          at,
        }];
      case 'task_started': {
        const agentId = str(msg.task_id);
        if (!agentId) return [];
        const agentType = str(msg.subtype_type) || str(msg.subagent_type) || 'agent';
        const toolUseId = str(msg.tool_use_id);
        typeByTask.set(agentId, agentType);
        if (toolUseId) taskByToolUse.set(toolUseId, agentId);
        return [{ t: 'agent:start', agentId, agentType, description: str(msg.description), toolUseId, at }];
      }
      case 'task_progress': {
        const agentId = str(msg.task_id);
        if (!agentId) return [];
        const usage = isRecord(msg.usage) ? msg.usage : {};
        return [{
          t: 'agent:progress',
          agentId,
          ...optional('lastTool', str(msg.last_tool_name) || undefined),
          ...optional('totalTokens', num(usage.total_tokens)),
          ...optional('toolUses', num(usage.tool_uses)),
          at,
        }];
      }
      case 'task_notification': {
        const agentId = str(msg.task_id);
        if (!agentId || stopped.has(agentId)) return [];
        stopped.add(agentId);
        const usage = isRecord(msg.usage) ? msg.usage : {};
        return [{
          t: 'agent:stop',
          agentId,
          agentType: typeByTask.get(agentId) ?? 'agent',
          ...optional('summary', str(msg.summary) || undefined),
          ...optional('totalTokens', num(usage.total_tokens)),
          ...optional('durationMs', num(usage.duration_ms)),
          at,
        }];
      }
      case 'task_updated': {
        const agentId = str(msg.task_id);
        const patch = isRecord(msg.patch) ? msg.patch : {};
        if (!agentId || patch.status !== 'completed' || stopped.has(agentId)) return [];
        stopped.add(agentId);
        return [{ t: 'agent:stop', agentId, agentType: typeByTask.get(agentId) ?? 'agent', at }];
      }
      default:
        // hook_*, thinking_tokens, task_summary, post_turn_summary and anything new: not ours.
        return [];
    }
  }

  function fromAssistant(msg: Rec, at: number): RunEvent[] {
    const agentId = agentFor(msg.parent_tool_use_id);
    const events: RunEvent[] = [];
    for (const block of contentBlocks(msg)) {
      if (block.type === 'tool_use') {
        events.push({ t: 'tool', toolUseId: str(block.id), name: str(block.name), ...optional('agentId', agentId), at });
      } else if (block.type === 'text') {
        const text = str(block.text);
        if (text.trim()) events.push({ t: 'text', text, ...optional('agentId', agentId), at });
      }
      // thinking blocks and anything else: not ours.
    }
    return events;
  }

  function fromUser(msg: Rec, at: number): RunEvent[] {
    const agentId = agentFor(msg.parent_tool_use_id);
    const events: RunEvent[] = [];
    for (const block of contentBlocks(msg)) {
      if (block.type !== 'tool_result') continue;
      events.push({
        t: 'tool:result',
        toolUseId: str(block.tool_use_id),
        isError: block.is_error === true,
        ...optional('agentId', agentId),
        at,
      });
    }
    return events;
  }

  /** The task a subagent-internal message belongs to, if we saw that Agent call start. */
  function agentFor(parentToolUseId: unknown): string | undefined {
    const id = str(parentToolUseId);
    return id ? taskByToolUse.get(id) : undefined;
  }
}

function fromRateLimit(msg: Rec, at: number): RunEvent[] {
  const info = isRecord(msg.rate_limit_info) ? msg.rate_limit_info : {};
  const status = str(info.status);
  if (!status || status === 'allowed') return [];
  const utilization = num(info.utilization);
  const type = str(info.rateLimitType);
  const parts = ['rate limit'];
  if (utilization !== undefined) parts.push(`${Math.round(utilization * 100)}%`);
  if (type) parts.push(`(${type})`);
  if (utilization === undefined && !type) parts.push(status);
  return [{ t: 'notice', text: parts.join(' '), at }];
}

function fromResult(msg: Rec, at: number): RunEvent {
  return {
    t: 'result',
    subtype: str(msg.subtype),
    ...optional('costUsd', num(msg.total_cost_usd)),
    ...optional('numTurns', num(msg.num_turns)),
    ...optional('durationMs', num(msg.duration_ms)),
    ...optional('sessionId', str(msg.session_id) || undefined),
    at,
  };
}

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `message.content` as an array of block records; anything else (string content, missing) is empty. */
function contentBlocks(msg: Rec): Rec[] {
  const message = isRecord(msg.message) ? msg.message : {};
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

function pluginNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => (isRecord(p) ? str(p.name) : str(p))).filter(Boolean);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Spread helper so optional RunEvent fields are absent rather than `undefined` when unknown. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

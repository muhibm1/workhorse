import type { ChangeDigest, Gate } from '@shared/types';

/**
 * Autopilot: the pieces that keep a run moving while nobody is at the desk.
 *
 * - `createAutoResume`: when a run dies on a usage limit, parse the reset time out of the
 *   CLI's own message and schedule one resume for just after it. Born from a live overnight
 *   run that hit the session limit at 06:00 and then sat idle until morning.
 * - `createStallTimer`: a run that emits nothing for a long stretch is probably stuck (the
 *   conductor has stalled silently twice); surface a notice instead of leaving the user to
 *   discover it hours later.
 * - `createGateNotifier`: when a change starts waiting on a human gate, POST an ntfy-style
 *   notification so a phone hears about it. Off unless the user configures a URL.
 *
 * Everything here is dependency-injected and timer-based so vitest can drive it; ipc.ts only
 * wires it to the real drivers, watcher, and settings.
 */

const MINUTE = 60_000;

/** The shapes the CLI uses for limit stops: "You've hit your session limit · resets 2:40am
 *  (America/Chicago)", "usage limit reached", and similar. */
export function isLimitError(message: string): boolean {
  return /\b(session|weekly|usage)\s+limit\b|hit your .*limit/i.test(message);
}

const RESET_RE = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i;

/** Wall-clock hour/minute of `now` in `timeZone` (undefined = local). Throws on a bad zone. */
function wallClockMinutes(now: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return get('hour') * 60 + get('minute');
}

/**
 * Milliseconds from `now` until the reset time named in a limit message, plus a two-minute
 * buffer, or null when the message carries no parseable time (then the caller falls back to a
 * fixed retry). A reset time earlier than the current wall clock means tomorrow.
 */
const RESET_IN_RE = /resets\s+in\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?/i;

export function parseLimitReset(message: string, now: Date): number | null {
  // "resets in 3h 20m": a duration, no clock or zone involved.
  const d = RESET_IN_RE.exec(message);
  if (d && (d[1] || d[2])) {
    return (parseInt(d[1] ?? '0', 10) * 60 + parseInt(d[2] ?? '0', 10)) * MINUTE + 2 * MINUTE;
  }

  const m = RESET_RE.exec(message);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  const target = hour * 60 + minute;
  let delta: number;
  try {
    delta = (target - wallClockMinutes(now, m[4]) + 24 * 60) % (24 * 60);
    // Wall-clock subtraction is off by the shift on a clock-change night. Check where the delay
    // actually lands in the zone and correct once, so the resume is not an hour early or late.
    const landed = wallClockMinutes(new Date(now.getTime() + delta * MINUTE), m[4]);
    delta += ((target - landed + 24 * 60 + 12 * 60) % (24 * 60)) - 12 * 60;
    if (delta < 0) delta += 24 * 60;
  } catch {
    return null; // unrecognised time zone name
  }
  return delta * MINUTE + 2 * MINUTE;
}

export interface AutoResume {
  /** Feed every run event through this; it tracks errors and schedules on exit. */
  onEvent(repoId: string, event: { t: string; message?: string; code?: number | null }): void;
  /** A human acted (start/resume/stop): drop any pending auto-resume for the repo. */
  cancel(repoId: string): void;
}

export function createAutoResume(opts: {
  resume: (repoId: string) => void;
  /** Surfaces a notice line in the run log ("auto-resume at 02:42"). */
  emit: (repoId: string, text: string) => void;
  hasActiveRun: (repoId: string) => boolean;
  /** A reset later than this is left to the human (default 8 h). */
  maxDelayMs?: number;
  /** Used when the message has no parseable reset time (default 30 min). */
  fallbackDelayMs?: number;
  /** Auto-resumes in a row that may hit the limit again before it is left to the human (3). */
  maxAttempts?: number;
  now?: () => number;
}): AutoResume {
  const maxDelay = opts.maxDelayMs ?? 8 * 60 * MINUTE;
  const fallback = opts.fallbackDelayMs ?? 30 * MINUTE;
  const maxAttempts = opts.maxAttempts ?? 3;
  const now = opts.now ?? Date.now;
  const lastError = new Map<string, string>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** Consecutive limit stops per repo. Bounds the loop when a reset time cannot be parsed (a
   *  weekly limit with a date, say): without it the 30-minute fallback would retry until the
   *  reset, starting a run every half hour. */
  const attempts = new Map<string, number>();

  return {
    // Relies on the drivers' contract that an `error` event is followed by that run's `exit`
    // (both drivers emit them back to back); `init` clears any leftover so a later run can
    // never inherit an earlier run's error. A driver that emits non-fatal `error` events
    // mid-run would need this revisited.
    onEvent(repoId, event) {
      if (event.t === 'init') lastError.delete(repoId);
      if (event.t === 'error' && typeof event.message === 'string') lastError.set(repoId, event.message);
      if (event.t !== 'exit') return;

      const message = lastError.get(repoId);
      lastError.delete(repoId);
      if (!message || !isLimitError(message)) {
        attempts.delete(repoId); // a run that ended any other way resets the streak
        return;
      }
      if (pending.has(repoId)) return;
      const tries = (attempts.get(repoId) ?? 0) + 1;
      if (tries > maxAttempts) {
        opts.emit(repoId, `usage limit: ${maxAttempts} auto-resumes in a row hit the limit again; resume manually when it lifts`);
        return;
      }
      attempts.set(repoId, tries);

      const parsed = parseLimitReset(message, new Date(now()));
      if (parsed !== null && parsed > maxDelay) {
        opts.emit(repoId, `usage limit: the reset is more than ${Math.round(maxDelay / (60 * MINUTE))}h away; resume manually when it lifts`);
        return;
      }
      const delay = parsed ?? fallback;
      const at = new Date(now() + delay);
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      // Say when the time is a guess, so a parse failure is visible in the log rather than
      // looking like a tracked reset (ecc-silent-failure-hunter finding).
      opts.emit(
        repoId,
        parsed === null
          ? `usage limit: auto-resume scheduled for ${hh}:${mm} (reset time not readable, so this is a retry, attempt ${tries} of ${maxAttempts})`
          : `usage limit: auto-resume scheduled for ${hh}:${mm}`,
      );
      pending.set(repoId, setTimeout(() => {
        pending.delete(repoId);
        if (opts.hasActiveRun(repoId)) return;
        try {
          opts.resume(repoId);
        } catch (err) {
          opts.emit(repoId, `auto-resume failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, delay));
    },

    cancel(repoId) {
      attempts.delete(repoId); // a human acted; the next limit stop starts a fresh streak
      const timer = pending.get(repoId);
      if (!timer) return;
      clearTimeout(timer);
      pending.delete(repoId);
      opts.emit(repoId, 'auto-resume cancelled');
    },
  };
}

export interface StallTimer {
  poke(): void;
  stop(): void;
}

/** Calls `onStall` whenever `timeoutMs` passes with no `poke()`, re-arming each time so a run
 *  that stays silent keeps being flagged rather than flagged once and forgotten. */
export function createStallTimer(timeoutMs: number, onStall: () => void): StallTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      onStall();
      arm();
    }, timeoutMs);
  };
  arm();
  return {
    poke() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      arm();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface GateNotification { title: string; body: string; }

export function buildGateNotification(repoName: string, digest: ChangeDigest): GateNotification {
  const gate = digest.blocking_gate ?? '?';
  return {
    title: `WorkHorse: ${gate} waiting on you`,
    body: `${repoName}: ${digest.title}\nTier ${digest.tier}, phase ${digest.phase}. Approve in Paddock or run /workhorse:approve ${gate}.`,
  };
}

/** POSTs in the shape ntfy.sh and compatible self-hosted servers accept: the body is the text,
 *  the title and priority ride in headers. Returns whether the server said ok; never throws. */
export async function postNotification(
  url: string,
  notification: GateNotification,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Title: notification.title, Priority: 'high', Tags: 'bell' },
      body: notification.body,
      // An unresponsive host must fail in seconds, not hang until the OS socket timeout.
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface GateNotifier {
  onDigests(repoId: string, repoName: string, digests: ChangeDigest[]): void;
}

/** Newest digest by `updated_at` (ISO-8601, so string order is time order). */
function newestDigest(digests: ChangeDigest[]): ChangeDigest | null {
  let best: ChangeDigest | null = null;
  for (const d of digests) if (!best || d.updated_at > best.updated_at) best = d;
  return best;
}

/**
 * Notifies once per gate arrival. The first digests for a repo only set the baseline: a gate
 * that was already waiting when the app opened should not ping the phone on every launch.
 */
export function createGateNotifier(opts: {
  getUrl: () => string | null;
  post: (url: string, n: GateNotification, repoId: string) => void;
}): GateNotifier {
  const lastGate = new Map<string, Gate | null>();
  return {
    onDigests(repoId, repoName, digests) {
      const newest = newestDigest(digests);
      const gate = newest?.blocking_gate ?? null;
      const isBaseline = !lastGate.has(repoId);
      const previous = lastGate.get(repoId) ?? null;
      lastGate.set(repoId, gate);
      if (isBaseline || !gate || gate === previous || !newest) return;
      const url = opts.getUrl();
      if (url) opts.post(url, buildGateNotification(repoName, newest), repoId);
    },
  };
}

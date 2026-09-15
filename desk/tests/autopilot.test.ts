import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGateNotification,
  createAutoResume,
  createGateNotifier,
  createStallTimer,
  isLimitError,
  parseLimitReset,
  postNotification,
} from '../src/main/autopilot';
import type { ChangeDigest } from '../src/shared/types';

const MIN = 60_000;

describe('isLimitError', () => {
  it('matches the shapes the CLI actually emits', () => {
    expect(isLimitError("You've hit your session limit · resets 2:40am (America/Chicago)")).toBe(true);
    expect(isLimitError('Weekly limit reached')).toBe(true);
    expect(isLimitError('usage limit reached · resets 10pm')).toBe(true);
    expect(isLimitError('ENOENT: no such file')).toBe(false);
    expect(isLimitError('rate limit 80%')).toBe(false); // a warning, not a stop
  });
});

describe('parseLimitReset', () => {
  // 2026-09-13T12:00:00Z is 07:00 in America/Chicago (CDT, UTC-5).
  const noon = new Date('2026-09-13T12:00:00Z');

  it('computes the delay to a later wall-clock time in the named zone, plus a 2-minute buffer', () => {
    const ms = parseLimitReset('resets 8:30am (America/Chicago)', noon);
    expect(ms).toBe(90 * MIN + 2 * MIN); // 07:00 -> 08:30
  });

  it('a time earlier than now means tomorrow', () => {
    const ms = parseLimitReset('resets 2:40am (America/Chicago)', noon);
    expect(ms).toBe((19 * 60 + 40) * MIN + 2 * MIN); // 07:00 -> 02:40 next day
  });

  it('handles pm and 12am/12pm', () => {
    expect(parseLimitReset('resets 12pm (America/Chicago)', noon)).toBe(5 * 60 * MIN + 2 * MIN);
    expect(parseLimitReset('resets 12am (America/Chicago)', noon)).toBe(17 * 60 * MIN + 2 * MIN);
  });

  it('returns null with no parseable time or a bad zone', () => {
    expect(parseLimitReset('usage limit reached', noon)).toBeNull();
    expect(parseLimitReset('resets 2:40am (Not/AZone)', noon)).toBeNull();
    expect(parseLimitReset('resets Oct 21 (America/Chicago)', noon)).toBeNull();
  });
});

describe('createAutoResume', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(overrides: { hasActiveRun?: boolean } = {}) {
    const resume = vi.fn();
    const emit = vi.fn();
    const ar = createAutoResume({
      resume,
      emit,
      hasActiveRun: () => overrides.hasActiveRun ?? false,
      fallbackDelayMs: 30 * MIN,
      maxDelayMs: 8 * 60 * MIN,
      now: () => Date.now(),
    });
    return { ar, resume, emit };
  }

  it('schedules one resume after a limit error + exit, using the fallback when unparseable', () => {
    const { ar, resume, emit } = make();
    ar.onEvent('r1', { t: 'error', message: 'usage limit reached' });
    ar.onEvent('r1', { t: 'exit', code: 0 });
    expect(emit).toHaveBeenCalledWith('r1', expect.stringContaining('auto-resume scheduled'));
    vi.advanceTimersByTime(30 * MIN - 1);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(resume).toHaveBeenCalledExactlyOnceWith('r1');
  });

  it('does nothing on a clean exit or a non-limit error', () => {
    const { ar, resume, emit } = make();
    ar.onEvent('r1', { t: 'exit', code: 0 });
    ar.onEvent('r2', { t: 'error', message: 'boom' });
    ar.onEvent('r2', { t: 'exit', code: 1 });
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(resume).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('an init clears the previous run error, so the next exit stays quiet', () => {
    const { ar, resume } = make();
    ar.onEvent('r1', { t: 'error', message: 'usage limit reached' });
    ar.onEvent('r1', { t: 'init' });
    ar.onEvent('r1', { t: 'exit', code: 0 });
    vi.advanceTimersByTime(60 * MIN);
    expect(resume).not.toHaveBeenCalled();
  });

  it('cancel drops the pending resume and says so', () => {
    const { ar, resume, emit } = make();
    ar.onEvent('r1', { t: 'error', message: 'usage limit reached' });
    ar.onEvent('r1', { t: 'exit', code: 0 });
    ar.cancel('r1');
    expect(emit).toHaveBeenCalledWith('r1', 'auto-resume cancelled');
    vi.advanceTimersByTime(60 * MIN);
    expect(resume).not.toHaveBeenCalled();
  });

  it('cancel with nothing pending stays silent', () => {
    const { ar, emit } = make();
    ar.cancel('r1');
    expect(emit).not.toHaveBeenCalled();
  });

  it('skips the resume when a run is already active at fire time', () => {
    const { ar, resume } = make({ hasActiveRun: true });
    ar.onEvent('r1', { t: 'error', message: 'usage limit reached' });
    ar.onEvent('r1', { t: 'exit', code: 0 });
    vi.advanceTimersByTime(31 * MIN);
    expect(resume).not.toHaveBeenCalled();
  });

  it('a reset beyond the cap is left to the human', () => {
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z')); // 07:00 in Chicago
    const { ar, resume, emit } = make();
    ar.onEvent('r1', { t: 'error', message: "hit your weekly limit · resets 6:00am (America/Chicago)" });
    ar.onEvent('r1', { t: 'exit', code: 0 });
    expect(emit).toHaveBeenCalledWith('r1', expect.stringContaining('resume manually'));
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(resume).not.toHaveBeenCalled();
  });
});

describe('createStallTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after quiet, stays quiet while poked, re-arms, and stops cleanly', () => {
    const onStall = vi.fn();
    const timer = createStallTimer(10 * MIN, onStall);
    vi.advanceTimersByTime(9 * MIN);
    timer.poke();
    vi.advanceTimersByTime(9 * MIN);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1 * MIN);
    expect(onStall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * MIN); // re-armed: a still-silent run is flagged again
    expect(onStall).toHaveBeenCalledTimes(2);
    timer.stop();
    vi.advanceTimersByTime(60 * MIN);
    expect(onStall).toHaveBeenCalledTimes(2);
  });
});

function digest(overrides: Partial<ChangeDigest>): ChangeDigest {
  return {
    change_id: 'c1', title: 'Add /health', client: 'acme', repo: 'svc', tier: 1,
    tier_reason: '', phase: 'spec', mode: 'normal', status_label: 'Spec',
    waiting_on: 'You (G2)', blocking_gate: 'G2',
    gates: { G1: 'auto', G2: 'pending', G3: 'pending', G4: 'pending', G5: 'pending' },
    required_human_gates: ['G2', 'G4'], verification: 'none', branch: 'wh/c1', pr_url: '',
    commit: '', problem: '', outcome: '', tldr: '', decisions: [], last_approval: null,
    artifacts: [], artifact_dir: 'docs/sdlc/c1',
    tracker: { provider: '', database: '', page_id: null },
    updated_at: '2026-09-13T10:00:00Z',
    ...overrides,
  } as ChangeDigest;
}

describe('createGateNotifier', () => {
  it('baselines the first digests, notifies on a new gate, once, and again for the next gate', () => {
    const post = vi.fn();
    let url: string | null = 'https://ntfy.sh/topic';
    const notifier = createGateNotifier({ getUrl: () => url, post });

    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: 'G2' })]); // app start: already waiting
    expect(post).not.toHaveBeenCalled();

    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: null })]); // approved, moving on
    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: 'G4', phase: 'review' })]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].title).toBe('WorkHorse: G4 waiting on you');

    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: 'G4', phase: 'review' })]); // same gate again
    expect(post).toHaveBeenCalledTimes(1);

    url = null; // turned off in settings
    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: null })]);
    notifier.onDigests('r1', 'svc', [digest({ blocking_gate: 'G5', phase: 'deploy' })]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('uses the newest digest when a repo has several changes', () => {
    const post = vi.fn();
    const notifier = createGateNotifier({ getUrl: () => 'https://ntfy.sh/t', post });
    const older = digest({ change_id: 'old', blocking_gate: 'G2', updated_at: '2026-09-12T00:00:00Z' });
    notifier.onDigests('r1', 'svc', [older, digest({ blocking_gate: null })]); // baseline: newest has no gate
    notifier.onDigests('r1', 'svc', [older, digest({ blocking_gate: 'G4', title: 'Newest' })]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].body).toContain('Newest');
  });
});

describe('buildGateNotification / postNotification', () => {
  it('carries repo, title, tier, phase and the approve command', () => {
    const n = buildGateNotification('svc', digest({ blocking_gate: 'G4', phase: 'review' }));
    expect(n.title).toBe('WorkHorse: G4 waiting on you');
    expect(n.body).toBe('svc: Add /health\nTier 1, phase review. Approve in Paddock or run /workhorse:approve G4.');
  });

  it('POSTs the ntfy shape and never throws', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const ok = await postNotification('https://ntfy.sh/t', { title: 'T', body: 'B' }, fetchFn as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('https://ntfy.sh/t', expect.objectContaining({
      method: 'POST',
      headers: { Title: 'T', Priority: 'high', Tags: 'bell' },
      body: 'B',
      signal: expect.any(AbortSignal), // bounded: an unresponsive host fails in seconds
    }));
    const down = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(postNotification('https://x', { title: 'T', body: 'B' }, down as unknown as typeof fetch)).resolves.toBe(false);
  });
});

describe('fixes for wh-bug-reviewer findings on 4f25dd3', () => {
  it('parses the "resets in" duration form', () => {
    const now = new Date('2026-09-13T12:00:00Z');
    expect(parseLimitReset('limit reached · resets in 3h 20m', now)).toBe((200 + 2) * MIN);
    expect(parseLimitReset('resets in 45m', now)).toBe((45 + 2) * MIN);
  });

  it('lands on the real reset across the autumn clock change', () => {
    // 00:30 CDT on 2026-11-01 is 05:30Z. Clocks fall back at 02:00, so "2:40am" is 2:40 CST,
    // 08:40Z: 190 minutes away, not the 130 that wall-clock subtraction gives.
    const ms = parseLimitReset('resets 2:40am (America/Chicago)', new Date('2026-11-01T05:30:00Z'));
    expect(ms).toBe((190 + 2) * MIN);
  });

  describe('auto-resume streak cap', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function setup() {
      const resume = vi.fn();
      const emit = vi.fn();
      const ar = createAutoResume({ resume, emit, hasActiveRun: () => false, fallbackDelayMs: 5 * MIN, maxAttempts: 3 });
      const limitStop = () => {
        // A date-form reset cannot be parsed, so each stop falls back to the retry delay.
        ar.onEvent('r1', { t: 'error', message: 'hit your weekly limit · resets Oct 9, 5pm' });
        ar.onEvent('r1', { t: 'exit', code: 0 });
        vi.advanceTimersByTime(6 * MIN);
      };
      return { ar, resume, emit, limitStop };
    }

    it('says when the resume time is a guess rather than a read reset', () => {
      const { emit, limitStop } = setup();
      limitStop();
      expect(emit).toHaveBeenCalledWith('r1', expect.stringContaining('reset time not readable'));
      expect(emit).toHaveBeenCalledWith('r1', expect.stringContaining('attempt 1 of 3'));
    });

    it('stops after three consecutive limit stops and hands back to the human', () => {
      const { resume, emit, limitStop } = setup();
      limitStop(); limitStop(); limitStop();
      expect(resume).toHaveBeenCalledTimes(3);
      limitStop();
      expect(resume).toHaveBeenCalledTimes(3);
      expect(emit).toHaveBeenLastCalledWith('r1', expect.stringContaining('resume manually'));
    });

    it('a run that ends any other way resets the streak', () => {
      const { ar, resume, limitStop } = setup();
      limitStop(); limitStop();
      ar.onEvent('r1', { t: 'exit', code: 0 }); // a clean run in between
      limitStop(); limitStop(); limitStop();
      expect(resume).toHaveBeenCalledTimes(5);
    });
  });

  it('passes the repo id to post, so a failed push can be reported on that repo', () => {
    const post = vi.fn();
    const n = createGateNotifier({ getUrl: () => 'https://ntfy.sh/t', post });
    n.onDigests('r9', 'svc', [digest({ blocking_gate: null })]);
    n.onDigests('r9', 'svc', [digest({ blocking_gate: 'G2' })]);
    expect(post.mock.calls[0][2]).toBe('r9');
  });

  it('notifies again when a rejected gate is presented again', () => {
    // wh.js now reports a rejected gate as waiting on agents (blocking_gate null) until the
    // conductor sets it back to pending, so the re-presentation reads as a new arrival.
    const post = vi.fn();
    const n = createGateNotifier({ getUrl: () => 'https://ntfy.sh/t', post });
    n.onDigests('r1', 'svc', [digest({ blocking_gate: null })]);
    n.onDigests('r1', 'svc', [digest({ blocking_gate: 'G2' })]);
    n.onDigests('r1', 'svc', [digest({ blocking_gate: null })]);
    n.onDigests('r1', 'svc', [digest({ blocking_gate: 'G2' })]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

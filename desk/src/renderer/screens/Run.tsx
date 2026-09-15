/**
 * The Run screen (spec 2.2): the centrepiece of Paddock, for one repository. Merges the file
 * watcher's digest (phase, gates, waiting_on -- from `wh.js digest`) with the live event stream
 * (agents, tools, cost -- from the run driver) into one picture: the orb, the fourteen-station
 * ring around it, agent satellites, the primary action, the radial menu, the log rail and the
 * bottom status strip.
 *
 * Global Constraints: "No Date.now() in the renderer for elapsed times; `at` timestamps come
 * from main." Every elapsed value shown here (`Elapsed` in the status strip, a satellite's
 * `mm:ss`) is derived from `RunEvent.at` values already stamped by main, via `eventAtRange` --
 * never a fresh wall-clock read. A satellite's 1.5s "retiring" fade is likewise driven by a
 * scheduled `setTimeout`, not by comparing to a live clock, so it completes even if no further
 * event arrives to trigger a re-render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { usePaddockStore, type RunState } from '@/store';
import { Orb } from '@/components/Orb';
import { orbSpecFor } from '@/lib/orbState';
import { Station } from '@/components/Station';
import { Satellite, formatElapsed } from '@/components/Satellite';
import { RadialMenu, type RadialMenuItem } from '@/components/RadialMenu';
import { LogRail } from '@/components/LogRail';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ArrowRight, ChevronLeft } from '@/components/Icons';
import { polar, STATIONS, stationAngle, phaseIndex, type Station as StationSlot } from '@/lib/polar';
import type { ChangeDigest, Gate } from '@shared/types';
import './Run.css';

export interface RunProps {
  repoId: string;
}

const STAGE_SIZE = 640;
const STAGE_CENTER = STAGE_SIZE / 2;
const STATION_RADIUS = 240;
const SATELLITE_RADIUS = 300;
const ORB_SIZE = 320;
const MAX_SATELLITES = 12;
/** Spec 2.2: agent satellites retire with "a short fade" after `agent:stop`; plan Task 12: 1.5s. */
const RETIRE_MS = 1500;

type AgentEntry = RunState['agents'][string];

/** `wh-builder` -> `builder`. Mirrors the private helper of the same name in `store.ts` (not
 * exported there), so satellite labels match the short names the log rail already uses. */
function agentShortName(agentType: string): string {
  return agentType.replace(/^wh-/, '');
}

/**
 * Lit/current for one station, from the digest alone (plan Task 12): a phase station is lit once
 * the digest has reached or passed it; a gate station is lit once its own status is resolved
 * (`approved` or `auto`) rather than by phase position. "Current" means "the run is here right
 * now": the blocking gate when one is blocking, else the station matching the live phase.
 */
export function stationState(station: StationSlot, digest: ChangeDigest | null): { lit: boolean; current: boolean } {
  if (!digest) return { lit: false, current: false };

  if (station.kind === 'gate') {
    const status = station.gate ? digest.gates[station.gate] : undefined;
    return { lit: status === 'approved' || status === 'auto', current: digest.blocking_gate === station.gate };
  }

  const digestIdx = phaseIndex(digest.phase);
  // Onboard has no `phase` of its own; treat it as preceding Intent, so it lights up as soon as
  // any change exists (index 0 or later is always >= -1).
  const stationIdx = station.phase ? phaseIndex(station.phase) : -1;
  return {
    lit: digestIdx >= stationIdx,
    current: !digest.blocking_gate && station.phase === digest.phase,
  };
}

/**
 * The earliest and latest `RunEvent.at` this run has seen so far -- the renderer's stand-in for
 * "now" (see module doc). `agent:start`/`agent:stop` do not append a log line, so agent
 * timestamps are folded in alongside the log's own `at` values.
 */
export function eventAtRange(run: RunState | undefined): { first: number; last: number } | null {
  if (!run) return null;
  const ats: number[] = [];
  for (const line of run.log) ats.push(line.at);
  for (const agent of Object.values(run.agents)) {
    ats.push(agent.startedAt);
    if (agent.stoppedAt !== undefined) ats.push(agent.stoppedAt);
  }
  if (ats.length === 0) return null;
  let first = ats[0]!;
  let last = ats[0]!;
  for (const at of ats) {
    if (at < first) first = at;
    if (at > last) last = at;
  }
  return { first, last };
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function verificationTone(v: ChangeDigest['verification']): 'mint' | 'coral' | 'neutral' {
  return v === 'green' ? 'mint' : v === 'red' ? 'coral' : 'neutral';
}

export function Run({ repoId }: RunProps) {
  const digest = usePaddockStore((s) => s.digests[repoId]?.[0] ?? null);
  const run = usePaddockStore((s) => s.runs[repoId]);
  const settings = usePaddockStore((s) => s.settings);
  const startRun = usePaddockStore((s) => s.startRun);
  const resumeRun = usePaddockStore((s) => s.resumeRun);
  const stopRun = usePaddockStore((s) => s.stopRun);
  const go = usePaddockStore((s) => s.go);

  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [logPaused, setLogPaused] = useState(false);
  const [hiddenAgents, setHiddenAgents] = useState<ReadonlySet<string>>(() => new Set());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const logWrapRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // The composer opens under the 640px stage, below the fold on a laptop-height window.
  useEffect(() => {
    if (starting) composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [starting]);

  // Switching repos: nothing this screen owns locally should bleed from one run into another.
  useEffect(() => {
    setMenuOpen(false);
    setStatusOpen(false);
    setStarting(false);
    setPrompt('');
    setHiddenAgents(new Set());
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  }, [repoId]);

  // Unmount: don't leak timers past the screen's own lifetime.
  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
    },
    [],
  );

  // Every agent that has just stopped gets a one-shot timer; once it fires, the agent drops out
  // of `hiddenAgents`' complement (i.e. it is added to `hiddenAgents`) and the chip disappears.
  useEffect(() => {
    if (!run) return;
    for (const [agentId, agent] of Object.entries(run.agents)) {
      if (agent.stoppedAt === undefined) continue;
      if (hiddenAgents.has(agentId) || timersRef.current.has(agentId)) continue;
      const timer = setTimeout(() => {
        timersRef.current.delete(agentId);
        setHiddenAgents((prev) => new Set(prev).add(agentId));
      }, RETIRE_MS);
      timersRef.current.set(agentId, timer);
    }
  }, [run, hiddenAgents]);

  const atRange = useMemo(() => eventAtRange(run), [run]);
  const nowAt = atRange?.last ?? 0;
  const elapsedMs = atRange ? atRange.last - atRange.first : 0;

  const blockingGate: Gate | null = digest?.blocking_gate ?? null;

  const orbSpec = useMemo(
    () =>
      orbSpecFor({
        phase: digest?.phase ?? null,
        blockingGate,
        running: run?.running ?? false,
        error: Boolean(run?.error),
        done: digest?.phase === 'done',
      }),
    [digest?.phase, blockingGate, run?.running, run?.error],
  );

  const satellites = useMemo(() => {
    if (!run) return { visible: [] as [string, AgentEntry][], shown: [] as [string, AgentEntry][], overflow: 0 };
    const visible = Object.entries(run.agents)
      .filter(([agentId]) => !hiddenAgents.has(agentId))
      .sort(([, a], [, b]) => a.startedAt - b.startedAt);
    const shown = visible.slice(0, MAX_SATELLITES);
    return { visible, shown, overflow: visible.length - shown.length };
  }, [run, hiddenAgents]);

  const satelliteSlots = satellites.shown.length + (satellites.overflow > 0 ? 1 : 0);

  const handleStart = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = prompt.trim();
      if (!trimmed) return;
      void startRun(repoId, trimmed);
      setStarting(false);
      setPrompt('');
    },
    [prompt, repoId, startRun],
  );

  const gateForPacket: Gate | null = blockingGate ?? digest?.last_approval?.gate ?? null;

  const menuItems: RadialMenuItem[] = useMemo(
    () => [
      { label: 'Status', onSelect: () => setStatusOpen(true) },
      {
        label: 'Packet',
        onSelect: () => {
          if (gateForPacket) go({ name: 'gate', repoId, gate: gateForPacket });
        },
      },
      { label: 'Log', onSelect: () => logWrapRef.current?.focus() },
      { label: 'Sync', onSelect: () => void startRun(repoId, '__sync__') },
    ],
    [gateForPacket, go, repoId, startRun],
  );

  return (
    <div className="run-screen">
      <div className="run-grid">
        <aside className="run-left">
          <Panel title="Change" className="run-change-panel">
            {digest ? (
              <>
                <div className="run-change-title">{digest.title}</div>
                <div className="run-change-sub label">
                  {digest.client} / {digest.repo}
                </div>
                <div className="run-change-badges">
                  <Badge tone="cyan">{digest.phase}</Badge>
                  <Badge tone="neutral">{`Tier ${digest.tier}`}</Badge>
                  <Badge tone={blockingGate ? 'amber' : 'neutral'}>{digest.waiting_on}</Badge>
                  <Badge tone={verificationTone(digest.verification)}>{digest.verification}</Badge>
                </div>
                <dl className="run-change-fields">
                  <dt className="label">Problem</dt>
                  <dd>{digest.problem || '—'}</dd>
                  <dt className="label">Outcome</dt>
                  <dd>{digest.outcome || '—'}</dd>
                  <dt className="label">Branch</dt>
                  <dd className="mono">{digest.branch || '—'}</dd>
                </dl>
              </>
            ) : (
              <p className="run-change-empty">No change yet in this repository.</p>
            )}
          </Panel>
          <button type="button" className="run-back" onClick={() => go({ name: 'fleet' })}>
            <ChevronLeft />
            Back to Fleet
          </button>
        </aside>

        <section className="run-center">
          <div className="run-stage" style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
            {STATIONS.map((station, i) => {
              const { x, y } = polar(STAGE_CENTER, STAGE_CENTER, STATION_RADIUS, stationAngle(i));
              const { lit, current } = stationState(station, digest);
              const gate = station.gate;
              const onClick = gate && lit ? () => go({ name: 'gate', repoId, gate }) : undefined;
              const title =
                station.kind === 'gate'
                  ? `${station.label} — ${digest ? digest.gates[gate as Gate] : 'pending'}`
                  : station.label;
              return (
                <Station
                  key={station.key}
                  label={station.label}
                  kind={station.kind}
                  lit={lit}
                  current={current}
                  x={x}
                  y={y}
                  onClick={onClick}
                  title={title}
                />
              );
            })}

            {satellites.shown.map(([agentId, agent], i) => {
              const { x, y } = polar(STAGE_CENTER, STAGE_CENTER, SATELLITE_RADIUS, (i * 360) / satelliteSlots);
              return (
                <Satellite
                  key={agentId}
                  label={agentShortName(agent.agentType)}
                  startedAt={agent.startedAt}
                  now={nowAt}
                  x={x}
                  y={y}
                  retiring={agent.stoppedAt !== undefined}
                  title={agent.description || agent.agentType}
                />
              );
            })}

            {satellites.overflow > 0 &&
              (() => {
                const { x, y } = polar(
                  STAGE_CENTER,
                  STAGE_CENTER,
                  SATELLITE_RADIUS,
                  (satellites.shown.length * 360) / satelliteSlots,
                );
                return (
                  <div className="satellite satellite-overflow" style={{ left: x, top: y }}>
                    <span className="satellite-label">{`+${satellites.overflow}`}</span>
                  </div>
                );
              })()}

            <button
              type="button"
              className="run-orb-hit"
              style={{ left: STAGE_CENTER, top: STAGE_CENTER, width: ORB_SIZE, height: ORB_SIZE }}
              onClick={() => setMenuOpen(true)}
              aria-label="Open orb menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Orb spec={orbSpec} size={ORB_SIZE} agentCount={satellites.visible.length} />
            </button>

            <RadialMenu
              open={menuOpen}
              cx={STAGE_CENTER}
              cy={STAGE_CENTER}
              r={STATION_RADIUS}
              items={menuItems}
              onClose={() => setMenuOpen(false)}
            />

            {statusOpen && (
              <div className="run-status-sheet">
                <Panel title="Status" active className="run-status-panel">
                  <button
                    type="button"
                    className="run-status-close"
                    onClick={() => setStatusOpen(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                  {digest ? (
                    <dl className="run-status-fields mono">
                      <dt>Phase</dt>
                      <dd>{digest.phase}</dd>
                      <dt>Tier</dt>
                      <dd>{`${digest.tier} — ${digest.tier_reason}`}</dd>
                      <dt>Waiting on</dt>
                      <dd>{digest.waiting_on}</dd>
                      <dt>Blocking gate</dt>
                      <dd>{digest.blocking_gate ?? 'none'}</dd>
                      <dt>Verification</dt>
                      <dd>{digest.verification}</dd>
                      <dt>Status</dt>
                      <dd>{digest.status_label}</dd>
                      <dt>Updated</dt>
                      <dd>{digest.updated_at}</dd>
                    </dl>
                  ) : (
                    <p>No digest yet.</p>
                  )}
                </Panel>
              </div>
            )}
          </div>

          {run && !run.running && run.error && (
            <p className="run-error" role="alert">
              {`Last run stopped: ${run.error}`}
            </p>
          )}
          <div className="run-primary">
            {run?.running ? (
              <Button tone="danger" onClick={() => void stopRun(repoId)}>
                Stop run
              </Button>
            ) : blockingGate ? (
              // Both buttons open the Gate screen (spec 2.3: "Opened from ... the primary
              // action"); the real approve/reject calls, with required-for-reject notes, live
              // there (Task 13).
              <div className="run-gate-actions">
                <Button tone="amber" onClick={() => go({ name: 'gate', repoId, gate: blockingGate })}>
                  {`Approve ${blockingGate}`}
                </Button>
                <Button tone="danger" onClick={() => go({ name: 'gate', repoId, gate: blockingGate })}>
                  Reject
                </Button>
              </div>
            ) : digest && digest.phase !== 'done' ? (
              // A finished change has nothing to resume; offer Start for the next one instead.
              <Button tone="primary" onClick={() => void resumeRun(repoId)}>
                Resume
              </Button>
            ) : starting ? (
              <form className="composer run-start-form" ref={composerRef} onSubmit={handleStart}>
                <textarea
                  className="composer-input mono"
                  autoFocus
                  rows={5}
                  value={prompt}
                  aria-label="Problem and outcome"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter makes a new line: the chat convention.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                    if (e.key === 'Escape') setStarting(false);
                  }}
                  placeholder="Describe the problem in your own words, then the outcome you want."
                />
                <div className="composer-foot">
                  <span className="composer-hint">problem -&gt; outcome · Enter to start · Shift+Enter new line</span>
                  <div className="composer-actions">
                    <Button type="button" tone="ghost" size="sm" onClick={() => setStarting(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" tone="primary" size="sm" disabled={!prompt.trim()}>
                      Start
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <Button tone="primary" onClick={() => setStarting(true)}>
                Start
              </Button>
            )}
          </div>
        </section>

        <div className="run-right" ref={logWrapRef} tabIndex={-1}>
          <LogRail lines={run?.log ?? []} paused={logPaused} onTogglePause={() => setLogPaused((p) => !p)} />
        </div>
      </div>

      <footer className="run-status-strip mono">
        <span className="run-strip-item">
          Session <span className="run-strip-value tnum">{run?.sessionId ?? '—'}</span>
        </span>
        <span className="run-strip-item">
          Backend <span className="run-strip-value">{settings?.backend ?? '—'}</span>
        </span>
        <span className="run-strip-item">
          Elapsed <span className="run-strip-value tnum">{formatElapsed(elapsedMs)}</span>
        </span>
        <span className="run-strip-item">
          Cost <span className="run-strip-value tnum">{run ? formatCost(run.costUsd) : '—'}</span>
        </span>
        {digest && digest.verification !== 'none' && (
          <span className={`run-strip-verification run-strip-${verificationTone(digest.verification)}`}>
            {`verification ${digest.verification}`}
          </span>
        )}
      </footer>
    </div>
  );
}

/**
 * Fleet screen (spec 2.1): every registered repository as a card, sorted with human-blocked
 * changes first, then repos with a run in progress, then idle ones. Clicking a card, or pressing
 * Enter or Space on it, opens that repo's Run screen.
 *
 * Each card carries an `AsciiField` strip. Its mask is `max(AMBIENT_FLOOR, glyph)`, so the whole
 * strip holds a faint field and the active phase's letter emerges from it. Density rises while a
 * run is active and on hover; the ink is amber when a gate waits on you and cyan while running.
 *
 * Registering a repo: the native folder dialog (`store.addRepo`) or dropping a folder onto the
 * screen. `onDrop` reads `e.dataTransfer.files[0].path`, which only Electron's renderer populates
 * on a dropped `File` (not part of the DOM `File` type, hence the local cast).
 *
 * "Not onboarded" comes from `repo.onboarded`, which main computes from whether
 * `.workhorse/profile.yml` exists and refreshes on every watcher event. It is not inferred from
 * digests: a freshly onboarded repo has a profile but no changes, and must not offer onboarding
 * again. The Onboard button collects the client context first and sends `__onboard__:<context>`,
 * which `ipc.ts` turns into `/workhorse:onboard <context>` so the headless run never stops to ask.
 */
import { useMemo, useState, type DragEvent } from 'react';
import type { ChangeDigest, Phase, RepoRef } from '@shared/types';
import { gateLabel } from '@shared/gates';
import { usePaddockStore, type RunState } from '@/store';
import { glyph } from '@/lib/asciiMask';
import { AsciiField } from '@/components/AsciiField';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ChevronRight, PlusIcon } from '@/components/Icons';
import './Fleet.css';

/** Fixed card width so the card's `AsciiField` strip (a canvas; it needs real pixel dimensions,
 * not a percentage) always matches the card it sits in. `fleet-cards` wraps them in a flex grid
 * rather than stretching each card to fill a track. */
const CARD_WIDTH = 340;
const CARD_PADDING = 18;
const FIELD_WIDTH = CARD_WIDTH - 2 * CARD_PADDING - 2; // minus the 1px border on each side
const FIELD_HEIGHT = 88;

const GLYPH_FONT = "'JetBrains Mono', ui-monospace, monospace";
// Tuned from measurement, not guessed: at 0.25 idle, noise x density rarely cleared the
// ramp's first step, so the field drew almost nothing even with its colour resolved.
const IDLE_DENSITY = 0.7;
const RUNNING_DENSITY = 1.0;
const HOVER_DENSITY_BOOST = 0.25;
/** Mask floor outside the phase glyph, so the whole strip carries an ambient field. */
const AMBIENT_FLOOR = 0.45;

/** Tier 0-1 read as neutral, 2 as amber. Tier 3 is also `neutral` here — Badge.tsx /
 * primitives.css style it violet off a `data-tier="3"` attribute instead of a badge tone. */
function tierTone(tier: number): BadgeTone {
  return tier === 2 ? 'amber' : 'neutral';
}

function verificationTone(verification: ChangeDigest['verification']): BadgeTone {
  if (verification === 'green') return 'mint';
  if (verification === 'red') return 'coral';
  return 'neutral';
}

/** What the card's ASCII field spells: the active phase's first letter, or a centre dot when
 * there is no active change to name. */
function phaseGlyphChar(phase: Phase | null | undefined): string {
  return phase ? phase.charAt(0).toUpperCase() : '·';
}

type FleetRank = 0 | 1 | 2;

function waitingOnYou(digest: ChangeDigest | null): boolean {
  return Boolean(digest?.blocking_gate && digest.waiting_on.startsWith('You'));
}

/** Spec 2.1 sort key: human-blocked first, then a repo with a run in progress, then idle.
 * `Array#sort` is stable, so ties keep the repos' existing relative order. */
function fleetRank(digest: ChangeDigest | null, run: RunState | undefined): FleetRank {
  if (waitingOnYou(digest)) return 0;
  if (run?.running) return 1;
  return 2;
}

function activeAgentCount(run: RunState | undefined): number {
  if (!run) return 0;
  return Object.values(run.agents).filter((agent) => agent.stoppedAt === undefined).length;
}

/** Electron populates a real filesystem `path` on a dropped `File`; the DOM lib's `File` type
 * does not declare it. */
function droppedPath(e: DragEvent<HTMLDivElement>): string | null {
  const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
  return file?.path ?? null;
}

interface FleetCardProps {
  repo: RepoRef;
  digest: ChangeDigest | null;
  run: RunState | undefined;
  onboarded: boolean;
  onStartOnboard: (context: string) => void;
  /** Opens this repo's Run screen — the only route to it, so the card itself is the affordance. */
  onOpen: () => void;
}

function FleetCard({ repo, digest, run, onboarded, onStartOnboard, onOpen }: FleetCardProps) {
  const [hovered, setHovered] = useState(false);
  const [asking, setAsking] = useState(false);
  const [context, setContext] = useState('');

  const running = run?.running ?? false;
  const waiting = waitingOnYou(digest);
  const agents = activeAgentCount(run);
  // Rasterising a glyph touches the DOM (asciiMask.ts's `glyph`), so this is memoised per
  // character rather than redone on every hover/density re-render.
  const mask = useMemo(() => {
    const shape = glyph(phaseGlyphChar(digest?.phase), GLYPH_FONT);
    // A glyph alone confines the texture to one letter, and a card with no phase gets a dot's
    // worth of area. The floor gives the whole strip an ambient field and lets the phase letter
    // emerge from it.
    return (u: number, v: number) => Math.max(AMBIENT_FLOOR, shape(u, v));
  }, [digest?.phase]);
  const density = (running ? RUNNING_DENSITY : IDLE_DENSITY) + (hovered ? HOVER_DENSITY_BOOST : 0);
  const fieldColor = waiting ? 'var(--amber)' : running ? 'var(--cyan)' : 'var(--ink-faint)';

  const cls = ['fleet-card', waiting ? 'fleet-card-waiting' : '', onboarded ? '' : 'fleet-card-new']
    .filter(Boolean)
    .join(' ');

  return (
    <Panel
      className={cls}
      style={{ width: CARD_WIDTH }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${repo.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="fleet-card-head">
        <div className="fleet-card-names">
          <span className="fleet-card-repo">{repo.name}</span>
          <span className="label">{onboarded ? (digest?.client ?? 'onboarded') : 'not onboarded'}</span>
        </div>
        {onboarded &&
          (waiting && digest?.blocking_gate ? (
            <Badge tone="amber">{`You · ${gateLabel(digest, digest.blocking_gate)}`}</Badge>
          ) : running ? (
            <Badge tone="cyan">{agents > 0 ? `${agents} ${agents === 1 ? 'agent' : 'agents'}` : 'running'}</Badge>
          ) : (
            <Badge tone="neutral">idle</Badge>
          ))}
      </div>

      {!onboarded ? (
        asking ? (
          // Collected here rather than left to the skill: runs are headless, so a bare
          // /workhorse:onboard stops at its "what industry?" question with nobody to answer.
          <form
            className="fleet-onboard"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const trimmed = context.trim();
              if (!trimmed) return;
              setAsking(false);
              onStartOnboard(trimmed);
            }}
          >
            <textarea
              className="fleet-onboard-input"
              autoFocus
              rows={4}
              value={context}
              placeholder="Industry, users, hosting, compliance regimes"
              aria-label="Client context"
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAsking(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="fleet-onboard-foot">
              <span className="composer-hint">Enter to start · Shift+Enter new line</span>
              <Button type="submit" tone="amber" size="sm" disabled={!context.trim()}>
                Onboard
              </Button>
            </div>
          </form>
        ) : (
          <div className="fleet-card-onboard">
            <p className="fleet-card-text">
              WorkHorse has not audited this repository yet. Onboarding writes its profile, codebase map and
              client CLAUDE.md.
            </p>
            <Button
              tone="amber"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setAsking(true);
              }}
            >
              Onboard
            </Button>
          </div>
        )
      ) : (
        <>
          <div className="fleet-card-field">
            <AsciiField width={FIELD_WIDTH} height={FIELD_HEIGHT} color={fieldColor} density={density} mask={mask} />
          </div>
          {digest ? (
            <>
              <p className="fleet-card-text">{digest.title}</p>
              <div className="fleet-card-badges">
                <Badge tone={digest.phase === 'done' ? 'mint' : 'cyan'}>{digest.phase}</Badge>
                <Badge tone={tierTone(digest.tier)} data-tier={digest.tier === 3 ? '3' : undefined}>
                  Tier {digest.tier}
                </Badge>
                <Badge tone={verificationTone(digest.verification)}>{digest.verification}</Badge>
              </div>
            </>
          ) : (
            <p className="fleet-card-text fleet-card-text-muted">No active change</p>
          )}
          <div className="fleet-card-foot">
            <span className="fleet-card-meta mono">{digest?.status_label ?? 'ready for a change'}</span>
            <span className={`fleet-card-cta${waiting ? ' fleet-card-cta-amber' : running ? ' fleet-card-cta-cyan' : ''}`}>
              {waiting ? 'Review' : running ? 'Watch' : 'Open'}
              <ChevronRight />
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

export function Fleet() {
  const repos = usePaddockStore((s) => s.repos);
  const digests = usePaddockStore((s) => s.digests);
  const runs = usePaddockStore((s) => s.runs);
  const activeDigest = usePaddockStore((s) => s.activeDigest);
  const addRepo = usePaddockStore((s) => s.addRepo);
  const addRepoPath = usePaddockStore((s) => s.addRepoPath);
  const startRun = usePaddockStore((s) => s.startRun);
  const go = usePaddockStore((s) => s.go);

  const [dragOver, setDragOver] = useState(false);

  const sorted = useMemo(
    () =>
      [...repos].sort(
        (a, b) => fleetRank(digests[a.id]?.[0] ?? null, runs[a.id]) - fleetRank(digests[b.id]?.[0] ?? null, runs[b.id]),
      ),
    [repos, digests, runs],
  );

  const summary = useMemo(() => {
    const onboardedCount = repos.filter((r) => r.onboarded ?? (digests[r.id]?.length ?? 0) > 0).length;
    const runningCount = repos.filter((r) => runs[r.id]?.running).length;
    const waitingCount = repos.filter((r) => waitingOnYou(digests[r.id]?.[0] ?? null)).length;
    return `${onboardedCount} onboarded · ${runningCount} running · ${waitingCount} waiting on you`;
  }, [repos, digests, runs]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const path = droppedPath(e);
    if (path) void addRepoPath(path);
  };

  if (repos.length === 0) {
    return (
      <div
        className={`fleet fleet-empty${dragOver ? ' fleet-dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="fleet-empty-card">
          <h1 className="fleet-title">No repositories yet</h1>
          <p className="fleet-empty-hint">Drop a repository folder anywhere in this window, or pick one.</p>
          <Button tone="primary" onClick={() => void addRepo()}>
            <PlusIcon />
            Add repository
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fleet${dragOver ? ' fleet-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="fleet-head">
        <div className="fleet-head-text">
          <h1 className="fleet-title">Repositories</h1>
          <p className="fleet-summary">{summary}</p>
        </div>
        <Button tone="primary" onClick={() => void addRepo()}>
          <PlusIcon />
          Add repository
        </Button>
      </div>
      <div className="fleet-cards">
        {sorted.map((repo) => {
          const digest = activeDigest(repo.id);
          const onboarded = repo.onboarded ?? (digests[repo.id]?.length ?? 0) > 0;
          return (
            <FleetCard
              key={repo.id}
              repo={repo}
              digest={digest}
              run={runs[repo.id]}
              onboarded={onboarded}
              onStartOnboard={(context) => {
                void startRun(repo.id, `__onboard__:${context}`);
                go({ name: 'run', repoId: repo.id });
              }}
              onOpen={() => go({ name: 'run', repoId: repo.id })}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fleet screen (spec 2.1): every registered repository as a card in a responsive grid, sorted
 * with human-blocked changes first, then repos with a run in progress, then idle ones. Clicking a
 * card, or pressing Enter or Space on it, opens that repo's Run screen.
 *
 * Each card carries an `AsciiField` background. Its mask is `max(AMBIENT_FLOOR, glyph)`, so the
 * whole card holds a faint field and the active phase's letter emerges from it. Density rises
 * while a run is active and on hover.
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
import { usePaddockStore, type RunState } from '@/store';
import { glyph } from '@/lib/asciiMask';
import { AsciiField } from '@/components/AsciiField';
import { Panel } from '@/components/Panel';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button } from '@/components/Button';
import './Fleet.css';

/** Fixed footprint so the card's `AsciiField` (a canvas; it needs real pixel dimensions, not a
 * percentage) always matches the card it paints. `fleet-cards` wraps them in a flex grid rather
 * than stretching each card to fill a track. */
const CARD_WIDTH = 340;
const CARD_HEIGHT = 176;

const GLYPH_FONT = "'JetBrains Mono', ui-monospace, monospace";
// Tuned from measurement, not guessed: at 0.25 idle, noise x density rarely cleared the
// ramp's first step, so the field drew almost nothing even with its colour resolved.
const IDLE_DENSITY = 0.7;
const RUNNING_DENSITY = 1.0;
const HOVER_DENSITY_BOOST = 0.25;
/** Mask floor outside the phase glyph, so the whole card carries an ambient field. */
const AMBIENT_FLOOR = 0.45;

/** Tier 0-1 read as neutral, 2 as amber (plan T11). Tier 3 is also `neutral` here — Badge.tsx /
 * theme.css style it violet off a `data-tier="3"` attribute instead of a badge tone. */
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

/** Spec 2.1 sort key: human-blocked first, then a repo with a run in progress, then idle.
 * `Array#sort` is stable, so ties keep the repos' existing relative order. */
function fleetRank(digest: ChangeDigest | null, run: RunState | undefined): FleetRank {
  if (digest?.blocking_gate && digest.waiting_on.startsWith('You')) return 0;
  if (run?.running) return 1;
  return 2;
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
  // Rasterising a glyph touches the DOM (asciiMask.ts's `glyph`), so this is memoised per
  // character rather than redone on every hover/density re-render.
  const mask = useMemo(() => {
    const shape = glyph(phaseGlyphChar(digest?.phase), GLYPH_FONT);
    // A glyph alone confines the texture to one letter, and a card with no phase gets a dot's
    // worth of area: measured at 25 of 59,840 pixels painted. The floor gives the whole card an
    // ambient field and lets the phase letter emerge from it.
    return (u: number, v: number) => Math.max(AMBIENT_FLOOR, shape(u, v));
  }, [digest?.phase]);
  const density = (running ? RUNNING_DENSITY : IDLE_DENSITY) + (hovered ? HOVER_DENSITY_BOOST : 0);
  const waitingOnYou = Boolean(digest && digest.waiting_on.startsWith('You'));

  return (
    <Panel
      className="fleet-card"
      active={waitingOnYou}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${repo.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <AsciiField
        className="fleet-card-field"
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        color="var(--ink-faint)"
        density={density}
        mask={mask}
      />
      <div className="fleet-card-body">
        <div className="fleet-card-header">
          <span className="label">{repo.name}</span>
          {digest && <span className="fleet-card-client label">{digest.client}</span>}
        </div>

        {!onboarded ? (
          <div className="fleet-card-onboard">
            <p className="fleet-card-title fleet-card-title-muted">Not onboarded</p>
            {asking ? (
              // Collected here rather than left to the skill: runs are headless, so a bare
              // /workhorse:onboard stops at its "what industry?" question with nobody to answer.
              <form
                className="fleet-card-onboard-form"
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
                  className="fleet-card-onboard-input mono"
                  autoFocus
                  rows={4}
                  value={context}
                  placeholder={'industry, users, hosting, compliance regimes\n\nEnter to start, Shift+Enter for a new line'}
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
                <Button type="submit" tone="amber" size="sm" disabled={!context.trim()}>
                  Go
                </Button>
              </form>
            ) : (
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
            )}
          </div>
        ) : digest ? (
          <>
            <p className="fleet-card-title">{digest.title}</p>
            <div className="fleet-card-badges">
              <Badge tone="cyan">{digest.phase}</Badge>
              <Badge tone={tierTone(digest.tier)} data-tier={digest.tier === 3 ? '3' : undefined}>
                Tier {digest.tier}
              </Badge>
              <Badge tone={verificationTone(digest.verification)}>{digest.verification}</Badge>
              {waitingOnYou && <Badge tone="amber">{digest.waiting_on}</Badge>}
            </div>
          </>
        ) : (
          <p className="fleet-card-title fleet-card-title-muted">No active change</p>
        )}
      </div>
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
        className={`fleet fleet-empty${dragOver ? ' fleet-empty-dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="label">No repositories registered</p>
        <p className="fleet-empty-hint">Drop a repo folder here, or</p>
        <Button tone="primary" onClick={() => void addRepo()}>
          Add repository
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`fleet fleet-grid${dragOver ? ' fleet-grid-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="fleet-toolbar">
        <span className="label">Fleet</span>
        <Button tone="ghost" size="sm" onClick={() => void addRepo()}>
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

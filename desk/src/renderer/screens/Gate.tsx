/**
 * Gate screen (spec 2.3): the packet for one gate, rendered from markdown, with a sticky
 * left index of its `## ` sections, Approve / Reject forms, and a right-hand read-only sheet
 * for paths the packet links to.
 *
 * The packet file is picked by `gate` (spec 2.3's "the packet") and read from the active
 * digest's `artifact_dir`, which `wh.js digest` always emits with a trailing slash (see
 * `scripts/wh.js`), so the two are joined with a plain string concatenation -- `path.join`
 * would normalise to a backslash on Windows, and `artifact.read`'s guard (plan Global
 * Constraints: "artifact paths guarded to docs/sdlc/") wants a forward-slash relPath.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gate as GateId, GateStatus } from '@shared/types';
import { usePaddockStore } from '@/store';
import type { Screen } from '@/store';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/Button';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Markdown, slugify } from '@/components/Markdown';
import './Gate.css';

const PACKET_FILE: Record<GateId, string> = {
  G1: 'intent.md',
  G2: 'spec.md',
  G3: 'plan.md',
  G4: 'review-packet.md',
  G5: 'release.md',
};

const GATE_STATUS_TONE: Record<GateStatus, BadgeTone> = {
  pending: 'neutral',
  auto: 'cyan',
  approved: 'mint',
  rejected: 'coral',
  'n/a': 'none',
};

interface IndexEntry {
  text: string;
  slug: string;
}

/**
 * One entry per `## ` heading found in the raw markdown, in document order. Deliberately not
 * de-duplicated: `Markdown`'s own `h2` renderer (components/Markdown.tsx) slugifies each
 * heading the same way with no collision handling, so matching that keeps an index entry's
 * slug equal to the id `scrollToSlug` will find.
 */
function buildIndex(source: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const line of source.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) entries.push({ text: m[1], slug: slugify(m[1]) });
  }
  return entries;
}

type Load<T> = { status: 'loading' } | { status: 'loaded'; data: T } | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Matches plan T11's tier badge convention: neutral for 0-1, amber for 2, violet (via the
 * `data-tier="3"` attribute primitives.css styles) for 3 -- reused here so the header's tier
 * badge reads the same way it will on the Fleet card for the same change. */
function tierBadgeTone(tier: number): BadgeTone {
  return tier === 2 ? 'amber' : 'neutral';
}

export interface GateScreenProps {
  repoId: string;
  gate: GateId;
}

export function Gate({ repoId, gate }: GateScreenProps) {
  const digest = usePaddockStore((s) => s.activeDigest(repoId));
  const approveAction = usePaddockStore((s) => s.approve);
  const rejectAction = usePaddockStore((s) => s.reject);
  const go = usePaddockStore((s) => s.go);

  const [packet, setPacket] = useState<Load<string>>({ status: 'loading' });
  const [sheetPath, setSheetPath] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Load<string> | null>(null);

  const [approveNotes, setApproveNotes] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  const relPath = digest ? digest.artifact_dir + PACKET_FILE[gate] : null;

  useEffect(() => {
    if (!relPath) {
      setPacket({ status: 'error', message: 'No active change for this repository yet.' });
      return;
    }
    let cancelled = false;
    setPacket({ status: 'loading' });
    window.paddock.artifact
      .read(repoId, relPath)
      .then((text) => {
        if (!cancelled) setPacket({ status: 'loaded', data: text });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPacket({ status: 'error', message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
    // relPath is derived from repoId + gate + digest.artifact_dir; re-run whenever any of those change.
  }, [repoId, gate, relPath]);

  useEffect(() => {
    if (!sheetPath) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    setSheet({ status: 'loading' });
    window.paddock.artifact
      .read(repoId, sheetPath)
      .then((text) => {
        if (!cancelled) setSheet({ status: 'loaded', data: text });
      })
      .catch((err: unknown) => {
        if (!cancelled) setSheet({ status: 'error', message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, sheetPath]);

  const index = useMemo(() => (packet.status === 'loaded' ? buildIndex(packet.data) : []), [packet]);

  function scrollToSlug(slug: string) {
    const el = contentRef.current?.querySelector<HTMLElement>(`#${CSS.escape(slug)}`);
    el?.scrollIntoView({ block: 'start' });
  }

  async function handleApprove() {
    setActionError(null);
    setSubmitting('approve');
    try {
      await approveAction(repoId, gate, approveNotes);
      go({ name: 'run', repoId } satisfies Screen);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject() {
    if (rejectNotes.trim() === '') return;
    setActionError(null);
    setSubmitting('reject');
    try {
      await rejectAction(repoId, gate, rejectNotes);
      go({ name: 'run', repoId } satisfies Screen);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  const requiredGates = digest?.required_human_gates ?? [];
  const lastApproval = digest?.last_approval ?? null;
  const busy = submitting !== null;

  return (
    <div className="gate-screen grid-bg">
      <Panel className="gate-header" title={`Gate ${gate}`}>
        <div className="gate-header-row">
          <div className="gate-header-item">
            <span className="label">Tier</span>
            <Badge tone={digest ? tierBadgeTone(digest.tier) : 'neutral'} data-tier={digest?.tier === 3 ? 3 : undefined}>
              {digest ? `Tier ${digest.tier}` : '—'}
            </Badge>
          </div>
          <div className="gate-header-item">
            <span className="label">Required gates</span>
            <div className="gate-header-badges">
              {requiredGates.length === 0 && <span className="gate-muted">none</span>}
              {requiredGates.map((g) => (
                <Badge key={g} tone={digest ? GATE_STATUS_TONE[digest.gates[g]] : 'neutral'}>
                  {g}
                </Badge>
              ))}
            </div>
          </div>
          <div className="gate-header-item">
            <span className="label">Last approval</span>
            {lastApproval ? (
              <span className="gate-last-approval">
                <Badge tone={lastApproval.status === 'approved' ? 'mint' : 'coral'}>{lastApproval.gate}</Badge>
                {lastApproval.status} by {lastApproval.who} at {lastApproval.at}
                {lastApproval.notes ? ` — “${lastApproval.notes}”` : ''}
              </span>
            ) : (
              <span className="gate-muted">none yet</span>
            )}
          </div>
        </div>
      </Panel>

      <div className="gate-body">
        <Panel className="gate-index" title="Packet">
          <nav className="gate-index-nav" aria-label="Packet sections">
            {packet.status === 'loaded' && index.length === 0 && (
              <span className="gate-muted">No sections found.</span>
            )}
            <ul className="gate-index-list">
              {index.map((entry) => (
                <li key={entry.slug}>
                  <button type="button" className="gate-index-item" onClick={() => scrollToSlug(entry.slug)}>
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="gate-actions">
            <div className="gate-form">
              <label className="label" htmlFor="gate-approve-notes">
                Approve notes
              </label>
              <textarea
                id="gate-approve-notes"
                className="gate-textarea"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="Optional notes"
                rows={3}
                disabled={busy}
              />
              <Button tone="primary" onClick={handleApprove} disabled={busy}>
                {submitting === 'approve' ? 'Approving…' : `Approve ${gate}`}
              </Button>
            </div>

            <div className="gate-form">
              <label className="label" htmlFor="gate-reject-notes">
                Reject notes
              </label>
              <textarea
                id="gate-reject-notes"
                className="gate-textarea"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Required: why this is going back"
                rows={3}
                disabled={busy}
              />
              <Button tone="danger" onClick={handleReject} disabled={busy || rejectNotes.trim() === ''}>
                {submitting === 'reject' ? 'Rejecting…' : `Reject ${gate}`}
              </Button>
            </div>

            {actionError && <p className="gate-error">{actionError}</p>}
          </div>
        </Panel>

        <Panel className="gate-content" active>
          <div className="gate-content-scroll" ref={contentRef}>
            {packet.status === 'loading' && <p className="gate-muted">Loading packet…</p>}
            {packet.status === 'error' && <p className="gate-error">{packet.message}</p>}
            {packet.status === 'loaded' && (
              <Markdown source={packet.data} onOpenPath={(path) => setSheetPath(path)} />
            )}
          </div>
        </Panel>

        {sheetPath && (
          <Panel className="gate-sheet" title={sheetPath}>
            <div className="gate-sheet-header">
              <Button tone="ghost" size="sm" onClick={() => setSheetPath(null)}>
                Close
              </Button>
            </div>
            <div className="gate-sheet-body">
              {sheet?.status === 'loading' && <p className="gate-muted">Loading…</p>}
              {sheet?.status === 'error' && <p className="gate-error">{sheet.message}</p>}
              {sheet?.status === 'loaded' && <pre className="gate-sheet-pre">{sheet.data}</pre>}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

export default Gate;

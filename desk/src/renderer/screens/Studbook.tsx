/**
 * Studbook screen: ask the engineering record a question and get an answer whose every claim
 * cites the passage it came from. The query path runs in main (main/studbook); this screen is
 * pure UI over `window.paddock.studbook`, the same way Settings talks to `window.paddock.settings`.
 *
 * What it does that matters, carried over from Studbook's own page:
 * - Citations are the point. The model writes `[1]`, `[2]`; each renders as a chip that opens the
 *   exact passage. Answer text is inserted as text nodes and chips as elements, so a model
 *   response can never inject markup.
 * - A refusal looks different from an answer -- its own badge, an amber ring on the orb -- and still
 *   lists the passages that were retrieved, so "not in the record" is checkable, not taken on faith.
 * - The scope filter resolves what a bare question cannot: two near-identical sibling changes both
 *   answer "this change", and the model correctly refuses unless told which.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StudbookAnswer, StudbookPassage, StudbookRepo, StudbookStatus } from '@shared/types';
import { usePaddockStore } from '@/store';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Orb } from '@/components/Orb';
import type { OrbSpec } from '@/lib/orbState';
import './Studbook.css';

type Phase = 'idle' | 'asking' | 'answered' | 'refused' | 'error';

const ORB: Record<Phase, OrbSpec> = {
  idle: { state: 'breathing', speed: 1, ring: 'none', pulse: false },
  asking: { state: 'searching', speed: 1, ring: 'cyan', pulse: false },
  answered: { state: 'breathing', speed: 1, ring: 'mint', pulse: false },
  refused: { state: 'breathing', speed: 1, ring: 'amber', pulse: false },
  error: { state: 'breathing', speed: 1, ring: 'coral', pulse: false },
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Answer text split around `[n]` citations: text nodes and chip elements, never markup. */
function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const parts: ReactNode[] = [];
        let last = 0;
        for (const m of para.matchAll(/\[(\d+)\]/g)) {
          const n = Number(m[1]);
          parts.push(para.slice(last, m.index));
          parts.push(
            <button
              key={`${pi}-${m.index}`}
              type="button"
              className="studbook-cite"
              onClick={() => onCite(n)}
              title={`Open passage ${n}`}
            >
              {n}
            </button>,
          );
          last = (m.index ?? 0) + m[0].length;
        }
        parts.push(para.slice(last));
        return <p key={pi}>{parts}</p>;
      })}
    </>
  );
}

function progressLine(status: StudbookStatus | null): string | null {
  if (!status) return null;
  if (status.models === 'ready') return null;
  const p = status.progress;
  if (!p) return 'Loading the retrieval models (first time: a 1.5 GB download)…';
  if (p.stage === 'downloading') return `Downloading ${p.file ?? 'model files'}${p.percent !== undefined ? ` — ${Math.round(p.percent)}%` : ''}…`;
  if (p.stage === 'loading') return `Loading ${p.file ?? 'models'}…`;
  return null;
}

export function Studbook() {
  const go = usePaddockStore((s) => s.go);
  const hasApiKey = usePaddockStore((s) => s.hasApiKey);

  const [status, setStatus] = useState<StudbookStatus | null>(null);
  const [repos, setRepos] = useState<StudbookRepo[]>([]);
  const [question, setQuestion] = useState('');
  const [repo, setRepo] = useState('');
  const [changeId, setChangeId] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<StudbookAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPassage, setOpenPassage] = useState<number | null>(null);
  const receiptsRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.paddock.studbook.status());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // The scope filter needs the database; only fetch it once a connection string is stored.
  useEffect(() => {
    if (!status?.configured) return;
    let cancelled = false;
    window.paddock.studbook
      .repos()
      .then((r) => {
        if (!cancelled) setRepos(r);
      })
      .catch(() => {
        /* the filter is optional; the screen works without it, and `check` reports the cause */
      });
    return () => {
      cancelled = true;
    };
  }, [status?.configured]);

  // While a question is in flight the models may be downloading; poll so the line under the orb
  // says what is actually happening instead of "Asking…" for two minutes on first use.
  useEffect(() => {
    if (phase !== 'asking') return;
    const id = window.setInterval(() => void refreshStatus(), 1000);
    return () => window.clearInterval(id);
  }, [phase, refreshStatus]);

  const changes = useMemo(() => repos.find((r) => r.repo === repo)?.changes ?? [], [repos, repo]);

  async function ask() {
    const q = question.trim();
    if (!q || phase === 'asking') return;
    setPhase('asking');
    setError(null);
    setResult(null);
    setOpenPassage(null);
    try {
      const answer = await window.paddock.studbook.ask(q, { repo: repo || null, changeId: changeId || null });
      setResult(answer);
      setPhase(answer.refused ? 'refused' : 'answered');
    } catch (err) {
      setError(errorMessage(err));
      setPhase('error');
    } finally {
      void refreshStatus();
    }
  }

  function openCite(n: number) {
    setOpenPassage(n);
    // Let the <details> open before scrolling to it.
    window.setTimeout(() => {
      receiptsRef.current?.querySelector<HTMLElement>(`[data-passage="${n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  const configured = status?.configured ?? false;
  const canAsk = configured && hasApiKey && question.trim().length > 0 && phase !== 'asking';
  const progress = phase === 'asking' ? progressLine(status) : null;

  return (
    <div className="studbook-screen">
      <div className="studbook-left">
        <div className="studbook-orb">
          <Orb spec={ORB[phase]} size={140} />
          <p className="studbook-orb-line" aria-live="polite">
            {phase === 'asking'
              ? progress ?? 'Reading the record…'
              : status?.corpus
                ? `${status.corpus.documents} documents · ${status.corpus.chunks} passages`
                : configured
                  ? 'Ready'
                  : 'Not connected'}
          </p>
        </div>

        {!configured && (
          <Panel title="Connect" className="studbook-setup">
            <p className="studbook-hint">
              Studbook reads WorkHorse's own engineering record from its Postgres store. Paste the
              store's connection string once in Settings; it is kept encrypted and never shown again.
            </p>
            <Button tone="primary" size="sm" onClick={() => go({ name: 'settings' })}>
              Open Settings
            </Button>
          </Panel>
        )}

        {configured && !hasApiKey && (
          <Panel title="API key" className="studbook-setup">
            <p className="studbook-hint">
              Answers are written by Claude, so asking needs an Anthropic API key. Searching does not.
            </p>
            <Button tone="primary" size="sm" onClick={() => go({ name: 'settings' })}>
              Add a key in Settings
            </Button>
          </Panel>
        )}

        <form
          className="composer studbook-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <textarea
            id="studbook-question"
            className="composer-input"
            placeholder="Why did control state move into the git common dir?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={phase === 'asking'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void ask();
              }
            }}
          />
          <div className="composer-foot">
            <div className="studbook-scope">
              <select
                className="input studbook-select"
                aria-label="Repository"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setChangeId('');
                }}
                disabled={repos.length === 0}
              >
                <option value="">All repositories</option>
                {repos.map((r) => (
                  <option key={r.repo} value={r.repo}>
                    {r.repo}
                  </option>
                ))}
              </select>
              <select
                className="input studbook-select"
                aria-label="Change"
                value={changeId}
                onChange={(e) => setChangeId(e.target.value)}
                disabled={changes.length === 0}
              >
                <option value="">All changes</option>
                {changes.map((c) => (
                  <option key={c.changeId} value={c.changeId}>
                    {c.changeId}
                  </option>
                ))}
              </select>
            </div>
            <div className="composer-actions">
              <span className="composer-hint">Ctrl+Enter</span>
              <Button tone="primary" size="sm" type="submit" disabled={!canAsk}>
                {phase === 'asking' ? 'Asking…' : 'Ask'}
              </Button>
            </div>
          </div>
        </form>

        {error && <p className="studbook-error">{error}</p>}
      </div>

      <div className="studbook-right">
        {result ? (
          <Panel className="studbook-answer" active={phase === 'answered'}>
            {result.refused && <Badge tone="amber">not in the record</Badge>}
            <div className="studbook-answer-text">
              <AnswerText text={result.answer} onCite={openCite} />
            </div>

            <div className="studbook-receipts" ref={receiptsRef}>
              <h2 className="label">
                {result.citations.length > 0
                  ? `Receipts (${result.citations.length} cited)`
                  : 'Passages retrieved'}
              </h2>
              {[...result.passages]
                .sort((a, b) => {
                  const cited = new Set(result.citations.map((c) => c.number));
                  return Number(cited.has(b.number)) - Number(cited.has(a.number)) || a.number - b.number;
                })
                .map((p: StudbookPassage) => (
                  <details
                    key={p.number}
                    className="studbook-receipt"
                    data-passage={p.number}
                    open={openPassage === p.number}
                    onToggle={(e) => {
                      if ((e.currentTarget as HTMLDetailsElement).open) setOpenPassage(p.number);
                      else if (openPassage === p.number) setOpenPassage(null);
                    }}
                  >
                    <summary>
                      <span className="studbook-receipt-n">{p.number}</span>
                      <span className="studbook-receipt-where">
                        {p.repo} / {p.docType} — {p.headingPath}
                      </span>
                    </summary>
                    <pre className="studbook-chunk">{p.body}</pre>
                  </details>
                ))}
            </div>

            <p className="studbook-meta mono tnum">
              {result.model} · {result.inputTokens} in / {result.outputTokens} out
            </p>
          </Panel>
        ) : (
          <Panel className="studbook-empty">
            <p className="studbook-hint">
              Every claim cites the document it came from — click a{' '}
              <span className="studbook-cite studbook-cite-inert">1</span> to read the exact passage. If the
              record can't answer, it says so, and shows what it did find.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

export default Studbook;

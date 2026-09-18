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
import type { StudbookPassage, StudbookRepo, StudbookSearch, StudbookStatus, StudbookTurn } from '@shared/types';
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
/** Re-reading the repositories into the store: the orb works, cyan, no pulse. */
const ORB_SYNCING: OrbSpec = { state: 'working', speed: 1, ring: 'cyan', pulse: false };

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

/**
 * What a follow-up was searched for, when that differs from what was typed. A rewrite decides
 * which passages the answer could see, so it belongs on the receipt: if the rewrite picked the
 * wrong subject, this is where the reader can tell. Nothing for a fresh or unchanged question.
 */
function SearchedFor({ search }: { search: StudbookSearch }) {
  if (search.method === 'fresh' || search.method === 'unchanged') return null;
  const note =
    search.method === 'rewritten'
      ? null
      : search.method === 'fallback-guard'
        ? 'the rewrite added words not in this thread, so the thread’s questions were searched instead'
        : 'the rewrite failed, so the thread’s questions were searched instead';
  return (
    <p className="studbook-searched" title={search.rejected ? `Rejected rewrite: ${search.rejected}` : undefined}>
      <span className="label">Searched for</span> <span className="studbook-searched-query">{search.query}</span>
      {note && <span className="studbook-searched-note"> — {note}</span>}
    </p>
  );
}

/** One exchange: the question asked, the answer, and the passages behind it. */
function TurnView({
  turn,
  index,
  latest,
  openPassage,
  setOpenPassage,
  onCite,
}: {
  turn: StudbookTurn;
  index: number;
  latest: boolean;
  openPassage: string | null;
  setOpenPassage: (key: string | null) => void;
  onCite: (turnIndex: number, n: number) => void;
}) {
  const { answer, scope } = turn;
  const cited = new Set(answer.citations.map((c) => c.number));
  const passages = [...answer.passages].sort(
    (a, b) => Number(cited.has(b.number)) - Number(cited.has(a.number)) || a.number - b.number,
  );
  const scopeLabel = [scope.repo, scope.changeId].filter(Boolean).join(' / ');

  return (
    <Panel className="studbook-turn" active={latest && !answer.refused}>
      <div className="studbook-question-row">
        <p className="studbook-question">{answer.question}</p>
        {scopeLabel && <span className="studbook-scope-tag mono">{scopeLabel}</span>}
      </div>
      <SearchedFor search={answer.search} />
      {answer.refused && <Badge tone="amber">not in the record</Badge>}
      <div className="studbook-answer-text">
        <AnswerText text={answer.answer} onCite={(n) => onCite(index, n)} />
      </div>

      <details className="studbook-receipts-wrap" open={latest}>
        <summary className="label">
          {answer.citations.length > 0 ? `Receipts (${answer.citations.length} cited)` : 'Passages retrieved'}
        </summary>
        <div className="studbook-receipts">
          {passages.map((p: StudbookPassage) => {
            const key = `${index}:${p.number}`;
            return (
              <details
                key={p.number}
                className="studbook-receipt"
                data-passage={key}
                open={openPassage === key}
                onToggle={(e) => {
                  if ((e.currentTarget as HTMLDetailsElement).open) setOpenPassage(key);
                  else if (openPassage === key) setOpenPassage(null);
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
            );
          })}
        </div>
      </details>

      <p className="studbook-meta mono tnum">
        {answer.model} · {answer.inputTokens} in / {answer.outputTokens} out
      </p>
    </Panel>
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
  const turns = usePaddockStore((s) => s.studbookTurns);
  const addTurn = usePaddockStore((s) => s.studbookAddTurn);
  const clearTurns = usePaddockStore((s) => s.studbookClearTurns);
  /** The question in flight, shown at the foot of the transcript while it is answered. */
  const [pending, setPending] = useState<string | null>(null);
  /** The in-flight answer as it is written. Its `askId` is this tab's own tag, so a chunk from
   *  an ask we are no longer waiting on (a New thread mid-answer) is ignored rather than shown. */
  const [streaming, setStreaming] = useState<string>('');
  const askIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which receipt is open, keyed `<turn index>:<passage number>` so turns do not fight. */
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<StudbookStatus['lastSync']>(null);
  const receiptsRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      setLastSync(await window.paddock.studbook.sync());
      // Counts changed; check() re-reads them and the scope filter may have new repos.
      const next = await window.paddock.studbook.check();
      setStatus(next);
      setRepos(await window.paddock.studbook.repos());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
      void refreshStatus();
    }
  }

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

  useEffect(
    () =>
      window.paddock.studbook.onAnswerChunk((e) => {
        if (e.askId === askIdRef.current) setStreaming(e.snapshot);
      }),
    [],
  );

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
    if (phase !== 'asking' && !syncing) return;
    const id = window.setInterval(() => void refreshStatus(), 1000);
    return () => window.clearInterval(id);
  }, [phase, syncing, refreshStatus]);

  const syncLine = (() => {
    const s = status?.sync;
    if (!syncing || !s) return null;
    if (s.stage === 'embedding' && s.toEmbed) return `${s.repo}: embedding ${s.embedded ?? 0}/${s.toEmbed} changed passages…`;
    if (s.stage === 'embedding') return `${s.repo}: nothing changed`;
    return `${s.repo}: ${s.stage}…`;
  })();

  const changes = useMemo(() => repos.find((r) => r.repo === repo)?.changes ?? [], [repos, repo]);

  async function ask() {
    const q = question.trim();
    if (!q || phase === 'asking') return;
    const scope = { repo: repo || null, changeId: changeId || null };
    const askId = crypto.randomUUID();
    askIdRef.current = askId;
    setPhase('asking');
    setError(null);
    setPending(q);
    setStreaming('');
    setQuestion('');
    try {
      // Only the text of each turn goes back, not its passages: a follow-up is retrieved afresh.
      const history = turns.map((t) => ({ question: t.answer.question, answer: t.answer.answer }));
      const answer = await window.paddock.studbook.ask(q, scope, undefined, history, askId);
      addTurn({ answer, scope, at: Date.now() });
      setPhase(answer.refused ? 'refused' : 'answered');
    } catch (err) {
      setError(errorMessage(err));
      setQuestion(q); // hand the question back rather than losing it to a failed call
      setPhase('error');
    } finally {
      askIdRef.current = null;
      setPending(null);
      setStreaming('');
      void refreshStatus();
    }
  }

  function newThread() {
    clearTurns();
    setOpenPassage(null);
    setError(null);
    setPhase('idle');
  }

  function openCite(turnIndex: number, n: number) {
    const key = `${turnIndex}:${n}`;
    setOpenPassage(key);
    // Let the <details> open before scrolling to it.
    window.setTimeout(() => {
      receiptsRef.current?.querySelector<HTMLElement>(`[data-passage="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  const configured = status?.configured ?? false;
  const canAsk = configured && hasApiKey && question.trim().length > 0 && phase !== 'asking';
  const progress = phase === 'asking' ? progressLine(status) : null;

  return (
    <div className="studbook-screen">
      <div className="studbook-left">
        <div className="studbook-orb">
          <Orb spec={syncing ? ORB_SYNCING : ORB[phase]} size={140} />
          <p className="studbook-orb-line" aria-live="polite">
            {syncing
              ? syncLine ?? 'Refreshing the record…'
              : phase === 'asking'
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
            placeholder={
              turns.length > 0
                ? 'Follow up — “why?”, “what broke because of it?”'
                : 'Why did control state move into the git common dir?'
            }
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
              {turns.length > 0 && (
                <Button tone="ghost" size="sm" onClick={newThread} disabled={phase === 'asking'}>
                  New thread
                </Button>
              )}
              <span className="composer-hint">Ctrl+Enter</span>
              <Button tone="primary" size="sm" type="submit" disabled={!canAsk}>
                {phase === 'asking' ? 'Asking…' : turns.length > 0 ? 'Follow up' : 'Ask'}
              </Button>
            </div>
          </div>
        </form>

        {error && <p className="studbook-error">{error}</p>}

        {configured && (
          <div className="studbook-refresh">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={!status?.ingestConfigured || syncing || phase === 'asking'}
              title={
                status?.ingestConfigured
                  ? 'Re-read every registered repository into the store'
                  : 'Store the ingest connection string in Settings > Studbook to enable'
              }
            >
              {syncing ? 'Refreshing…' : 'Refresh the record'}
            </Button>
            {lastSync && !syncing && (
              <span className="studbook-refresh-summary mono">
                {lastSync.map((s) => `${s.repo}: ${s.documents} docs, ${s.chunksEmbedded} re-embedded`).join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="studbook-right" ref={receiptsRef}>
        {turns.length === 0 && !pending ? (
          <Panel className="studbook-empty">
            <p className="studbook-hint">
              Every claim cites the document it came from — click a{' '}
              <span className="studbook-cite studbook-cite-inert">1</span> to read the exact passage. If the
              record can't answer, it says so, and shows what it did find. Ask again to follow up: a
              question in the same thread can say “it” or “that change”.
            </p>
          </Panel>
        ) : (
          <>
            {turns.map((turn, i) => (
              <TurnView
                key={turn.at}
                turn={turn}
                index={i}
                latest={i === turns.length - 1 && phase !== 'asking'}
                openPassage={openPassage}
                setOpenPassage={setOpenPassage}
                onCite={openCite}
              />
            ))}
            {pending && (
              <Panel className="studbook-turn studbook-turn-pending">
                <div className="studbook-question-row">
                  <p className="studbook-question">{pending}</p>
                </div>
                {streaming ? (
                  // The citation chips are inert until the answer lands: the passages they open
                  // arrive with it, so a chip clicked mid-stream would have nothing to open.
                  <div className="studbook-answer-text studbook-answer-streaming">
                    <AnswerText text={streaming} onCite={() => undefined} />
                  </div>
                ) : (
                  <p className="studbook-hint">Reading the record…</p>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Studbook;

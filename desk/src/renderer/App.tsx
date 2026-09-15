/**
 * The app shell. Routes over the store's `screen` union to the five screens, boots the store
 * once on mount, and owns the two app-wide keyboard shortcuts: `Ctrl+,` (or `Cmd+,` on macOS)
 * opens Settings from anywhere, and `Escape` closes an open "menu" -- the only one at this level
 * is Settings itself, treated as a dismissable overlay, since `RadialMenu` already owns its own
 * Escape handling for the orb's radial menu on the Run screen.
 *
 * Setup (spec 2.5) renders whenever the system check has not resolved yet (`sys === null`, the
 * store's initial state before `boot()` resolves) or resolved to a missing prerequisite --
 * "Nothing else renders until both are present, except Settings" (spec 2.5), which `Setup` itself
 * offers a button into. The icon rail and top bar only appear once the app is `ready`, since
 * Fleet/Run/Gate all assume a working `claude`/`node`.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
// First, so each screen's stylesheet (imported by the screen modules below) lands after the
// primitives and can refine a `.panel` or `.btn` at equal specificity.
import './components/primitives.css';
import { usePaddockStore } from './store';
import { Fleet } from './screens/Fleet';
import { Run } from './screens/Run';
import { Gate } from './screens/Gate';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { ChevronRight, FleetIcon, LogoMark, RunIcon, SettingsIcon } from './components/Icons';
import './App.css';

/** `navigator.userAgentData`/`platform` both work here; either is fine for a Ctrl-vs-Cmd choice. */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
}

interface RailButtonProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function RailButton({ label, active, disabled = false, onClick, children }: RailButtonProps) {
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' rail-btn-active' : ''}`}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function App() {
  const sys = usePaddockStore((s) => s.sys);
  const screen = usePaddockStore((s) => s.screen);
  const boot = usePaddockStore((s) => s.boot);
  const go = usePaddockStore((s) => s.go);
  const repos = usePaddockStore((s) => s.repos);
  const digests = usePaddockStore((s) => s.digests);
  const activeDigest = usePaddockStore((s) => s.activeDigest);

  // The rail's Run button returns to the last repository opened, so it needs a memory the
  // screen union does not keep once you leave for Fleet or Settings.
  const [lastRepoId, setLastRepoId] = useState<string | null>(null);
  const currentRepoId = screen.name === 'run' || screen.name === 'gate' ? screen.repoId : null;
  useEffect(() => {
    if (currentRepoId) setLastRepoId(currentRepoId);
  }, [currentRepoId]);

  useEffect(() => {
    void boot();
    // Intentionally run once: `boot` is a stable store action, not a changing dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = sys !== null && sys.node.ok && sys.claude.ok;
  const showingSettings = screen.name === 'settings';

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const opensSettings = e.key === ',' && (isMac() ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (opensSettings) {
        e.preventDefault();
        go({ name: 'settings' });
        return;
      }
      if (e.key === 'Escape' && showingSettings) {
        go(ready ? { name: 'fleet' } : { name: 'setup' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, ready, showingSettings]);

  // Gates blocked on a human across every repository, for the top bar's pill. `digests` is read
  // so the memo recomputes when a watcher event lands; `activeDigest` reads the same store.
  const waiting = useMemo(
    () =>
      repos
        .map((repo) => ({ repo, digest: activeDigest(repo.id) }))
        .filter(({ digest }) => digest?.blocking_gate && digest.waiting_on.startsWith('You')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos, digests, activeDigest],
  );

  // Not ready and not (already) looking at Settings: Setup is the only thing on screen, spec 2.5.
  if (!ready && !showingSettings) {
    return (
      <main className="app-shell app-shell-setup">
        <Setup />
      </main>
    );
  }

  const lastRepo = repos.find((r) => r.id === lastRepoId) ?? null;
  const currentRepo = repos.find((r) => r.id === currentRepoId) ?? null;
  const firstWaiting = waiting[0];

  return (
    <div className="app-shell">
      {ready && (
        <nav className="app-rail" aria-label="Primary">
          <div className="app-logo" aria-hidden="true">
            <LogoMark />
          </div>
          <RailButton label="Fleet" active={screen.name === 'fleet'} onClick={() => go({ name: 'fleet' })}>
            <FleetIcon />
          </RailButton>
          <RailButton
            label={lastRepo ? `Run: ${lastRepo.name}` : 'Run'}
            active={currentRepoId !== null}
            disabled={!lastRepo}
            onClick={() => lastRepo && go({ name: 'run', repoId: lastRepo.id })}
          >
            <RunIcon />
          </RailButton>
          <RailButton label="Settings" active={showingSettings} onClick={() => go({ name: 'settings' })}>
            <SettingsIcon />
          </RailButton>
        </nav>
      )}
      <div className="app-main">
        {ready && (
          <header className="app-topbar">
            <nav className="app-crumbs" aria-label="Breadcrumb">
              {showingSettings ? (
                <span className="app-crumb-current">Settings</span>
              ) : currentRepo ? (
                <>
                  <button type="button" className="app-crumb" onClick={() => go({ name: 'fleet' })}>
                    Fleet
                  </button>
                  <ChevronRight />
                  {screen.name === 'gate' ? (
                    <>
                      <button type="button" className="app-crumb" onClick={() => go({ name: 'run', repoId: currentRepo.id })}>
                        {currentRepo.name}
                      </button>
                      <ChevronRight />
                      <span className="app-crumb-current">{`Gate ${screen.gate}`}</span>
                    </>
                  ) : (
                    <span className="app-crumb-current">{currentRepo.name}</span>
                  )}
                </>
              ) : (
                <span className="app-crumb-current">Fleet</span>
              )}
            </nav>
            {firstWaiting && firstWaiting.digest?.blocking_gate && (
              <button
                type="button"
                className="badge badge-amber app-waiting"
                onClick={() =>
                  go({ name: 'gate', repoId: firstWaiting.repo.id, gate: firstWaiting.digest!.blocking_gate! })
                }
                title={waiting.map(({ repo, digest }) => `${repo.name}: ${digest?.blocking_gate}`).join('\n')}
              >
                {waiting.length === 1 ? '1 gate waiting on you' : `${waiting.length} gates waiting on you`}
              </button>
            )}
          </header>
        )}
        <div className="app-content">
          {showingSettings ? (
            <Settings />
          ) : screen.name === 'run' ? (
            <Run repoId={screen.repoId} />
          ) : screen.name === 'gate' ? (
            <Gate repoId={screen.repoId} gate={screen.gate} />
          ) : (
            // 'fleet', and 'setup' as a defensive fallback: `boot()` always moves a ready app off
            // the initial 'setup' screen onto 'fleet' in the same state update that flips `ready`.
            <Fleet />
          )}
        </div>
      </div>
    </div>
  );
}

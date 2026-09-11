/**
 * The app shell (plan Task 15). Routes over the store's `screen` union to the five screens,
 * boots the store once on mount, and owns the two app-wide keyboard shortcuts: `Ctrl+,` (or
 * `Cmd+,` on macOS) opens Settings from anywhere, and `Escape` closes an open "menu" -- the only
 * one at this level is Settings itself, treated as a dismissable overlay, since `RadialMenu` (T8)
 * already owns its own Escape handling for the orb's radial menu on the Run screen.
 *
 * Setup (spec 2.5) renders whenever the system check has not resolved yet (`sys === null`, the
 * store's initial state before `boot()` resolves) or resolved to a missing prerequisite --
 * "Nothing else renders until both are present, except Settings" (spec 2.5), which `Setup` itself
 * offers a button into. So the one screen reachable without a passing `sys` check, alongside
 * `Setup`, is `Settings`; the left nav (Fleet, Settings) only appears once the app is `ready`,
 * since Fleet/Run/Gate all assume a working `claude`/`node`. `primitives.css` (T8) is imported
 * here per the stub's original note; this file otherwise fully replaces the T1 stub.
 */
import { useEffect } from 'react';
import { usePaddockStore } from './store';
import { Fleet } from './screens/Fleet';
import { Run } from './screens/Run';
import { Gate } from './screens/Gate';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import './components/primitives.css';
import './App.css';

/** `navigator.userAgentData`/`platform` both work here; either is fine for a Ctrl-vs-Cmd choice. */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
}

interface NavItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      className={`app-nav-item label${active ? ' app-nav-item-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function App() {
  const sys = usePaddockStore((s) => s.sys);
  const screen = usePaddockStore((s) => s.screen);
  const boot = usePaddockStore((s) => s.boot);
  const go = usePaddockStore((s) => s.go);

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

  // Not ready and not (already) looking at Settings: Setup is the only thing on screen, spec 2.5.
  if (!ready && !showingSettings) {
    return (
      <main className="app-shell app-shell-setup grid-bg">
        <Setup />
      </main>
    );
  }

  return (
    <div className="app-shell">
      {ready && (
        <nav className="app-nav" aria-label="Primary">
          <NavItem label="Fleet" active={screen.name === 'fleet'} onClick={() => go({ name: 'fleet' })} />
          <NavItem label="Settings" active={showingSettings} onClick={() => go({ name: 'settings' })} />
        </nav>
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
  );
}

/**
 * First-launch / prerequisite-failure screen (spec 2.5, plan Task 14).
 *
 * Rendered by the app shell (T15) whenever `sys` is null or either `sys.node.ok` or
 * `sys.claude.ok` is false. Nothing else in the app renders in that state except Settings, which
 * is the app shell's routing concern, not this component's.
 */
import type { SysCheck } from '@shared/types';
import { usePaddockStore } from '@/store';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/Button';
import './screens.css';

type PrereqInfo = SysCheck['node'];

export function Setup() {
  const sys = usePaddockStore((s) => s.sys);
  const boot = usePaddockStore((s) => s.boot);
  const go = usePaddockStore((s) => s.go);

  return (
    <main className="screen setup-screen grid-bg">
      <Panel title="Setup" className="setup-panel" active>
        <p>
          Paddock needs Node.js 18 or newer and the <span className="mono">claude</span> CLI on
          your PATH before it can watch repositories or drive runs.
        </p>

        <PrereqRow
          label="Node.js 18+"
          info={sys?.node}
          installHint="Install Node.js from nodejs.org, then restart Paddock."
        />
        <PrereqRow
          label="claude CLI"
          info={sys?.claude}
          installHint={'Install the Claude CLI and run "claude login", then check again.'}
        />

        <div className="setup-actions">
          <Button tone="primary" onClick={() => void boot()}>
            Check again
          </Button>
          <Button tone="ghost" onClick={() => go({ name: 'settings' })}>
            Settings
          </Button>
        </div>
      </Panel>
    </main>
  );
}

function PrereqRow({
  label,
  info,
  installHint,
}: {
  label: string;
  info?: PrereqInfo;
  installHint: string;
}) {
  const ok = info?.ok ?? false;
  return (
    <div className="setup-row">
      <span className={`setup-status ${ok ? 'setup-status-ok' : 'setup-status-missing'}`}>
        {ok ? 'OK' : 'Missing'}
      </span>
      <span className="label">{label}</span>
      {info?.version && <span className="mono tnum">{info.version}</span>}
      {!ok && <p className="settings-hint">{installHint}</p>}
    </div>
  );
}

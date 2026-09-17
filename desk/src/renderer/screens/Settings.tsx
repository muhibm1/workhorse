/**
 * Settings screen (spec 2.4, plan Task 14).
 *
 * Initial values (`sys`, `settings`, `hasApiKey`, `repos`) come from the store, which is where
 * `boot()` puts them. There is no store action for mutating settings, so — matching how the Gate
 * screen (T13) is specified to call `window.paddock.artifact.read` directly — every mutation here
 * goes straight through `window.paddock.settings`, then writes the result back onto the store with
 * `usePaddockStore.setState` so the rest of the app (and a re-visit of this screen) sees it too.
 */
import { useEffect, useState } from 'react';
import type { Backend, SysCheck } from '@shared/types';
import { usePaddockStore } from '@/store';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import './screens.css';

type PrereqInfo = SysCheck['node'];

function toolsToText(tools: string[] | undefined): string {
  return (tools ?? []).join('\n');
}

function textToTools(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function Settings() {
  const settings = usePaddockStore((s) => s.settings);
  const hasApiKey = usePaddockStore((s) => s.hasApiKey);
  const sys = usePaddockStore((s) => s.sys);
  const repos = usePaddockStore((s) => s.repos);

  const [backend, setBackend] = useState<Backend>(settings?.backend ?? 'cli');
  useEffect(() => {
    if (settings) setBackend(settings.backend);
  }, [settings?.backend]);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const [selectedRepoId, setSelectedRepoId] = useState<string>(repos[0]?.id ?? '');
  useEffect(() => {
    if (!selectedRepoId && repos[0]) setSelectedRepoId(repos[0].id);
  }, [repos, selectedRepoId]);

  const [toolsText, setToolsText] = useState<string>(toolsToText(settings?.allowedTools[selectedRepoId]));
  const [toolsSaved, setToolsSaved] = useState(false);
  useEffect(() => {
    setToolsText(toolsToText(settings?.allowedTools[selectedRepoId]));
    setToolsSaved(false);
  }, [selectedRepoId, settings]);

  async function onBackendChange(next: Backend) {
    setBackend(next);
    const updated = await window.paddock.settings.set({ backend: next });
    usePaddockStore.setState({ settings: updated });
  }

  async function onSaveApiKey() {
    if (!apiKeyInput) return;
    setApiKeyBusy(true);
    setApiKeyError(null);
    try {
      await window.paddock.settings.setApiKey(apiKeyInput);
      setApiKeyInput('');
      const has = await window.paddock.settings.hasApiKey();
      usePaddockStore.setState({ hasApiKey: has });
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeyBusy(false);
    }
  }

  async function onClearApiKey() {
    setApiKeyBusy(true);
    setApiKeyError(null);
    try {
      await window.paddock.settings.clearApiKey();
      const has = await window.paddock.settings.hasApiKey();
      usePaddockStore.setState({ hasApiKey: has });
    } finally {
      setApiKeyBusy(false);
    }
  }

  const [notifyInput, setNotifyInput] = useState<string>(settings?.notifyUrl ?? '');
  const [notifySaved, setNotifySaved] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  useEffect(() => {
    setNotifyInput(settings?.notifyUrl ?? '');
  }, [settings?.notifyUrl]);

  async function onSaveNotify() {
    setNotifyError(null);
    const updated = await window.paddock.settings.set({ notifyUrl: notifyInput.trim() || null });
    usePaddockStore.setState({ settings: updated });
    // The main process drops URLs it refuses (only https, or http to localhost, are accepted),
    // so a submitted value that did not stick is the user's signal something was wrong with it.
    if (notifyInput.trim() && updated.notifyUrl !== notifyInput.trim()) {
      setNotifyError('URL not saved: use https:// (or http://localhost for a local ntfy), and choose Allow when Paddock asks to confirm a new host.');
    } else {
      setNotifySaved(true);
    }
  }

  // Studbook's database connection string: stored encrypted in main like the API key, so this
  // screen only ever learns whether one exists, never its value.
  const [hasConninfo, setHasConninfo] = useState<boolean | null>(null);
  const [conninfoInput, setConninfoInput] = useState('');
  const [conninfoBusy, setConninfoBusy] = useState(false);
  const [conninfoError, setConninfoError] = useState<string | null>(null);
  const [conninfoCheck, setConninfoCheck] = useState<string | null>(null);
  useEffect(() => {
    window.paddock.studbook
      .hasConninfo()
      .then(setHasConninfo)
      .catch(() => setHasConninfo(false));
  }, []);

  async function onSaveConninfo() {
    if (!conninfoInput.trim()) return;
    setConninfoBusy(true);
    setConninfoError(null);
    setConninfoCheck(null);
    try {
      await window.paddock.studbook.setConninfo(conninfoInput);
      setConninfoInput('');
      setHasConninfo(await window.paddock.studbook.hasConninfo());
      const status = await window.paddock.studbook.check();
      setConninfoCheck(
        status.corpus ? `Connected: ${status.corpus.documents} documents, ${status.corpus.chunks} passages.` : 'Connected.',
      );
    } catch (err) {
      setConninfoError(err instanceof Error ? err.message : String(err));
    } finally {
      setConninfoBusy(false);
    }
  }

  async function onClearConninfo() {
    setConninfoBusy(true);
    setConninfoError(null);
    setConninfoCheck(null);
    try {
      await window.paddock.studbook.clearConninfo();
      setHasConninfo(await window.paddock.studbook.hasConninfo());
    } finally {
      setConninfoBusy(false);
    }
  }

  // The ingest role's connection string: only "Refresh the record" uses it, so it is optional.
  const [hasIngest, setHasIngest] = useState<boolean | null>(null);
  const [ingestInput, setIngestInput] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  useEffect(() => {
    window.paddock.studbook
      .hasIngestConninfo()
      .then(setHasIngest)
      .catch(() => setHasIngest(false));
  }, []);

  async function onSaveIngest() {
    if (!ingestInput.trim()) return;
    setIngestBusy(true);
    setIngestError(null);
    try {
      await window.paddock.studbook.setIngestConninfo(ingestInput);
      setIngestInput('');
      setHasIngest(await window.paddock.studbook.hasIngestConninfo());
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngestBusy(false);
    }
  }

  async function onClearIngest() {
    setIngestBusy(true);
    setIngestError(null);
    try {
      await window.paddock.studbook.clearIngestConninfo();
      setHasIngest(await window.paddock.studbook.hasIngestConninfo());
    } finally {
      setIngestBusy(false);
    }
  }

  async function onSaveTools() {
    if (!selectedRepoId || !settings) return;
    const updated = await window.paddock.settings.set({
      allowedTools: { ...settings.allowedTools, [selectedRepoId]: textToTools(toolsText) },
    });
    usePaddockStore.setState({ settings: updated });
    setToolsSaved(true);
  }

  return (
    <main className="screen settings-screen">
      <h1 className="label">Settings</h1>

      <Panel title="Backend" className="settings-panel">
        <div className="settings-radio-group" role="radiogroup" aria-label="Backend">
          <label className="settings-radio">
            <input
              type="radio"
              name="backend"
              value="cli"
              checked={backend === 'cli'}
              onChange={() => onBackendChange('cli')}
            />
            <span>
              CLI <span className="settings-hint">(uses your claude login)</span>
            </span>
          </label>
          <label className="settings-radio">
            <input
              type="radio"
              name="backend"
              value="sdk"
              checked={backend === 'sdk'}
              onChange={() => onBackendChange('sdk')}
            />
            <span>
              Agent SDK <span className="settings-hint">(API key)</span>
            </span>
          </label>
        </div>

        {backend === 'sdk' && (
          <div className="settings-field">
            <label className="label" htmlFor="api-key">
              API key
            </label>
            {hasApiKey ? (
              <div className="settings-key-row">
                <Badge tone="mint">Stored</Badge>
                <Button tone="ghost" size="sm" onClick={onClearApiKey} disabled={apiKeyBusy}>
                  Clear
                </Button>
              </div>
            ) : (
              <div className="settings-key-row">
                <input
                  id="api-key"
                  type="password"
                  className="settings-input"
                  placeholder="sk-ant-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  autoComplete="off"
                />
                <Button tone="primary" size="sm" onClick={onSaveApiKey} disabled={apiKeyBusy || !apiKeyInput}>
                  Save
                </Button>
              </div>
            )}
            {apiKeyError && <p className="settings-error">{apiKeyError}</p>}
          </div>
        )}
      </Panel>

      <Panel title="Plugin" className="settings-panel">
        <p className="mono">
          {sys?.plugin.bundled
            ? `Bundled (v${sys.plugin.version ?? '?'})`
            : (settings?.pluginPath ?? sys?.plugin.path ?? 'unknown')}
        </p>
        {sys?.plugin.path && <p className="settings-hint mono">{sys.plugin.path}</p>}
      </Panel>

      <Panel title="Per-repo allowed tools" className="settings-panel">
        {repos.length === 0 ? (
          <p className="settings-hint">No repositories added yet.</p>
        ) : (
          <>
            <label className="label" htmlFor="tools-repo">
              Repository
            </label>
            <select
              id="tools-repo"
              className="settings-select"
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <textarea
              className="settings-textarea"
              rows={8}
              value={toolsText}
              onChange={(e) => {
                setToolsText(e.target.value);
                setToolsSaved(false);
              }}
              placeholder={'Agent\nRead\nGlob\nBash(git *)'}
            />
            <div className="settings-key-row">
              <Button tone="primary" size="sm" onClick={onSaveTools}>
                Save
              </Button>
              {toolsSaved && <Badge tone="mint">Saved</Badge>}
            </div>
          </>
        )}
      </Panel>

      <Panel title="Phone notifications" className="settings-panel">
        <p className="settings-hint">
          When a change reaches a human gate, Paddock POSTs a push notification to this URL.
          Works with ntfy.sh: install the ntfy app, subscribe to a topic, and paste
          https://ntfy.sh/&lt;your-topic&gt; here. Leave empty to turn off.
        </p>
        <div className="settings-key-row">
          <input
            id="notify-url"
            type="text"
            className="settings-input"
            placeholder="https://ntfy.sh/my-private-topic"
            value={notifyInput}
            onChange={(e) => {
              setNotifyInput(e.target.value);
              setNotifySaved(false);
              setNotifyError(null);
            }}
            autoComplete="off"
          />
          <Button tone="primary" size="sm" onClick={onSaveNotify}>
            Save
          </Button>
          {notifySaved && <Badge tone="mint">Saved</Badge>}
        </div>
        {notifyError && <p className="settings-error">{notifyError}</p>}
      </Panel>

      <Panel title="Studbook" className="settings-panel">
        <p className="settings-hint">
          The Postgres connection string for Studbook's store, in libpq form
          (host=… port=… user=… password=… dbname=…) or as a postgres:// URL. Kept encrypted; every
          connection is verified against Supabase's pinned root certificate. Asking also needs the
          API key above.
        </p>
        {hasConninfo ? (
          <div className="settings-key-row">
            <Badge tone="mint">Stored</Badge>
            <Button tone="ghost" size="sm" onClick={onClearConninfo} disabled={conninfoBusy}>
              Clear
            </Button>
          </div>
        ) : (
          <div className="settings-key-row">
            <input
              id="studbook-conninfo"
              type="password"
              className="settings-input"
              placeholder="host=… user=… password=… dbname=…"
              value={conninfoInput}
              onChange={(e) => setConninfoInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button tone="primary" size="sm" onClick={onSaveConninfo} disabled={conninfoBusy || !conninfoInput.trim()}>
              {conninfoBusy ? 'Connecting…' : 'Save & test'}
            </Button>
          </div>
        )}
        {conninfoCheck && <p className="settings-hint">{conninfoCheck}</p>}
        {conninfoError && <p className="settings-error">{conninfoError}</p>}

        <div className="settings-field">
          <label className="label" htmlFor="studbook-ingest-conninfo">
            Refresh the record (optional)
          </label>
          <p className="settings-hint">
            The <em>ingest</em> role's connection string, so the Studbook tab can re-read every
            registered repository into the store itself. Without it the record only updates when
            the studbook repo's Python ingest is run.
          </p>
          {hasIngest ? (
            <div className="settings-key-row">
              <Badge tone="mint">Stored</Badge>
              <Button tone="ghost" size="sm" onClick={onClearIngest} disabled={ingestBusy}>
                Clear
              </Button>
            </div>
          ) : (
            <div className="settings-key-row">
              <input
                id="studbook-ingest-conninfo"
                type="password"
                className="settings-input"
                placeholder="host=… user=studbook_ingest_login.… password=… dbname=…"
                value={ingestInput}
                onChange={(e) => setIngestInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <Button tone="primary" size="sm" onClick={onSaveIngest} disabled={ingestBusy || !ingestInput.trim()}>
                Save
              </Button>
            </div>
          )}
          {ingestError && <p className="settings-error">{ingestError}</p>}
        </div>
      </Panel>

      <Panel title="Prerequisites" className="settings-panel">
        <PrereqRow label="node" info={sys?.node} />
        <PrereqRow label="claude" info={sys?.claude} />
      </Panel>

      <Panel title="Theme" className="settings-panel">
        <label className="settings-radio">
          <input type="radio" checked readOnly disabled />
          <span>
            Dark <span className="settings-hint">(only option in v1)</span>
          </span>
        </label>
      </Panel>
    </main>
  );
}

function PrereqRow({ label, info }: { label: string; info?: PrereqInfo }) {
  if (!info) return null;
  return (
    <div className="settings-prereq-row">
      <Badge tone={info.ok ? 'mint' : 'coral'}>{label}</Badge>
      <span className="mono tnum">{info.version ?? 'not found'}</span>
      {!info.ok && <span className="settings-hint">install {label} and check again</span>}
    </div>
  );
}

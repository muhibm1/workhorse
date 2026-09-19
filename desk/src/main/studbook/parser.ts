/**
 * Walks a repository into documents, ported from `studbook/ingest/parser.py`: one per markdown
 * file under docs/sdlc (excluding verify-logs/) and the top-level README, plus docs/superpowers
 * design docs when present, plus one per commit in `git log`. Pure with respect to the
 * filesystem it reads: no network, no database.
 *
 * Ids, doc types, change ids, tiers, dates and content hashes must equal the Python module's for
 * the same tree -- a chunk id is `<repo>/<path>#<ordinal>` and the store keys on it, so a port
 * that drifted would re-embed everything on every sync and leave duplicates behind. The chunk
 * parity gate (tests/studbook.chunks.gate.test.ts) holds this port to the Python output over the
 * live corpus.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ParsedDocument {
  /** `<repo>/<path>` for a file, `<repo>/git:<sha>` for a commit. */
  id: string;
  repo: string;
  /** Repo-relative, forward slashes; or `git:<sha>`. */
  path: string;
  docType: string;
  changeId: string | null;
  tier: number | null;
  /** YYYY-MM-DD. */
  docDate: string | null;
  /** Repo HEAD at ingest for a file; the commit's own sha for a commit. */
  commitSha: string;
  text: string;
  contentHash: string;
}

/** Filename stem -> doc_type for files directly under a change folder or the docs/sdlc root. */
const DOC_TYPE_BY_STEM: Record<string, string> = {
  intent: 'intent',
  spec: 'spec',
  plan: 'plan',
  evals: 'evals',
  verification: 'verification',
  'review-packet': 'review-packet',
  release: 'release',
  approvals: 'approvals',
  retro: 'retro',
  'conductor-log': 'conductor-log',
  'codebase-map': 'codebase-map',
  constraints: 'constraints',
};

const DATE_LINE = /^Date:\s*(\d{4}-\d{2}-\d{2})/m;
const TIER_LINE = /^Risk tier:\s*(\d)/m;

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `null` means skip: verify-logs/, and anything not in the doc-type table. `relPath` is posix. */
export function docTypeFor(relPath: string): string | null {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];
  if (parts.includes('verify-logs')) return null;
  if (name === 'README.md' && parts.length === 1) return 'readme';
  // The root changelog, or a component's (desk/CHANGELOG.md): as studbook's ingest/parser.py.
  if (name === 'CHANGELOG.md' && parts.length <= 2) return 'changelog';
  const isMd = name.endsWith('.md');
  if (parts.includes('adr') && isMd) return 'adr';
  if (parts[0] === 'docs' && parts[1] === 'superpowers' && isMd) return 'design-doc';
  const stem = name.replace(/\.[^.]*$/, '');
  return DOC_TYPE_BY_STEM[stem] ?? null;
}

export function changeIdFor(relPath: string, docType: string): string | null {
  const parts = relPath.split('/');
  if (parts.length >= 3 && parts[0] === 'docs' && parts[1] === 'sdlc' && docType !== 'codebase-map' && docType !== 'constraints') {
    return parts[2];
  }
  return null;
}

async function git(repoPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Every `.md` under `dir`, recursively, repo-relative posix paths, sorted the way Python's
 *  `sorted(Path.rglob(...))` sorts: by path components, then codepoint order. */
function markdownFilesUnder(repoPath: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const full = join(abs, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  const rel = out.map((abs) => abs.slice(repoPath.length + 1).split(sep).join('/'));
  return rel.sort((a, b) => {
    const pa = a.split('/');
    const pb = b.split('/');
    for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return pa.length - pb.length;
  });
}

export async function walkFiles(repo: string, repoPath: string): Promise<ParsedDocument[]> {
  const head = (await git(repoPath, 'rev-parse', 'HEAD')).trim();
  const docs: ParsedDocument[] = [];

  // Only intent.md states the tier; it is applied to every document in the same change.
  const tierByChange = new Map<string, number>();
  const sdlcRoot = join(repoPath, 'docs', 'sdlc');
  const sdlcExists = existsSync(sdlcRoot) && statSync(sdlcRoot).isDirectory();
  if (sdlcExists) {
    for (const entry of readdirSync(sdlcRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const intent = join(sdlcRoot, entry.name, 'intent.md');
      if (!existsSync(intent)) continue;
      const m = TIER_LINE.exec(readFileSync(intent, 'utf8'));
      if (m) tierByChange.set(entry.name, Number(m[1]));
    }
  }

  const candidates: string[] = [];
  if (sdlcExists) candidates.push(...markdownFilesUnder(repoPath, sdlcRoot));
  if (existsSync(join(repoPath, 'README.md'))) candidates.push('README.md');
  if (existsSync(join(repoPath, 'CHANGELOG.md'))) candidates.push('CHANGELOG.md');
  for (const entry of readdirSync(repoPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (existsSync(join(repoPath, entry.name, 'CHANGELOG.md'))) candidates.push(`${entry.name}/CHANGELOG.md`);
  }
  const designRoot = join(repoPath, 'docs', 'superpowers');
  if (existsSync(designRoot) && statSync(designRoot).isDirectory()) {
    candidates.push(...markdownFilesUnder(repoPath, designRoot));
  }

  for (const relPath of candidates) {
    const docType = docTypeFor(relPath);
    if (docType === null) continue;
    const text = readFileSync(join(repoPath, ...relPath.split('/')), 'utf8').replace(/\r\n/g, '\n');
    const changeId = changeIdFor(relPath, docType);
    const date = DATE_LINE.exec(text);
    docs.push({
      id: `${repo}/${relPath}`,
      repo,
      path: posix.normalize(relPath),
      docType,
      changeId,
      tier: changeId !== null ? (tierByChange.get(changeId) ?? null) : null,
      docDate: date ? date[1] : null,
      commitSha: head,
      text,
      contentHash: sha256(text),
    });
  }
  return docs;
}

// Record and field separators for `git log`, chosen to never plausibly occur in a message.
const COMMIT_SEP = '\x1e';
const FIELD_SEP = '\x1f';

/** One document per commit: doc_type 'commit', text = subject + body. No change id or tier. */
export async function walkCommits(repo: string, repoPath: string): Promise<ParsedDocument[]> {
  const log = await git(repoPath, 'log', `--format=${FIELD_SEP}%H${FIELD_SEP}%ad${FIELD_SEP}%B${COMMIT_SEP}`, '--date=short');
  const docs: ParsedDocument[] = [];
  // git's tformat appends "\n" after every record, including after this format's own trailing
  // separator, so each entry after the first starts with the previous record's newline.
  for (const raw of log.split(COMMIT_SEP)) {
    const entry = raw.replace(/^\n+/, '');
    if (!entry) continue;
    const [, sha, date, ...rest] = entry.split(FIELD_SEP);
    const message = rest.join(FIELD_SEP).replace(/^\n+|\n+$/g, '');
    if (!message) continue;
    docs.push({
      id: `${repo}/git:${sha}`,
      repo,
      path: `git:${sha}`,
      docType: 'commit',
      changeId: null,
      tier: null,
      docDate: date,
      commitSha: sha,
      text: message,
      contentHash: sha256(message),
    });
  }
  return docs;
}

/** Whether `repoPath` is the top level of its git repository, as opposed to a folder inside one. */
export async function isGitToplevel(repoPath: string): Promise<boolean> {
  try {
    const top = (await git(repoPath, 'rev-parse', '--show-toplevel')).trim();
    return normalise(top) === normalise(repoPath);
  } catch {
    return false;
  }
}

function normalise(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

/**
 * Files always; commits only when the folder is its repository's top level. Paddock can register
 * a folder that lives inside another repository (its own `examples/hello-service` does), and
 * `git log` run there would attribute the enclosing repository's whole history to it. The Python
 * parser has no such guard because its corpus only ever names repository roots.
 */
export async function walkRepo(repo: string, repoPath: string): Promise<ParsedDocument[]> {
  const files = await walkFiles(repo, repoPath);
  const commits = (await isGitToplevel(repoPath)) ? await walkCommits(repo, repoPath) : [];
  return [...files, ...commits];
}

/** The store's key for a repository: its folder name, lowercased, which is what the schema's
 *  `repo` check admits and how the Python corpus names the same repositories. */
export function repoKeyFor(repoPath: string): string {
  const base = repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return base.toLowerCase();
}

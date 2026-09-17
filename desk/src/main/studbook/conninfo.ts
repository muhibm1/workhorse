/**
 * Turns a Postgres connection string into `pg` client options.
 *
 * Studbook's `STUDBOOK_DATABASE_URL` is libpq keyword/value conninfo (`user=... password=...
 * host=...`), written that way by its bootstrap because it survives passwords with URL-hostile
 * characters. psycopg parses it natively; `pg` only takes URLs, and fed a conninfo it resolved the
 * host as "base" (from "database") — found by the parity gate (studbook/docs/paddock-gate.md).
 * This parses the way libpq does: whitespace-separated `key=value`, a value optionally single-
 * quoted with backslash escapes. A `postgres://` URL is passed through untouched.
 *
 * Pure: no I/O, no Electron, so it is unit-tested directly. The parsed object holds the password
 * and must never leave the main process.
 */

export interface ConninfoFields {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** Any libpq key this module does not map (sslmode, application_name, ...). Ignored by `pg`. */
  extra: Record<string, string>;
}

export type PgTarget = { connectionString: string } | ConninfoFields;

const KEY_MAP: Record<string, keyof Omit<ConninfoFields, 'extra'>> = {
  host: 'host',
  hostaddr: 'host',
  port: 'port',
  user: 'user',
  password: 'password',
  dbname: 'database',
};

const KV_RE = /(\w+)\s*=\s*(?:'((?:\\.|[^'])*)'|(\S+))/g;

export function parseConninfo(text: string): PgTarget {
  const trimmed = text.trim();
  if (/^postgres(ql)?:\/\//i.test(trimmed)) return { connectionString: trimmed };

  const fields: ConninfoFields = { extra: {} };
  for (const m of trimmed.matchAll(KV_RE)) {
    const key = m[1].toLowerCase();
    const raw = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
    const mapped = KEY_MAP[key];
    if (mapped === 'port') fields.port = Number(raw);
    else if (mapped) fields[mapped] = raw;
    else fields.extra[key] = raw;
  }
  return fields;
}

/** True when the string names at least a host — the minimum a stored conninfo must carry. */
export function looksLikeConninfo(text: string): boolean {
  const target = parseConninfo(text);
  if ('connectionString' in target) return true;
  return typeof target.host === 'string' && target.host.length > 0;
}

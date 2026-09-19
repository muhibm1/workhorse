/**
 * desk/CHANGELOG.md must describe the version package.json says this is. Studbook answers
 * release-order questions from it, so a release without an entry leaves it answering from a stale
 * record without anyone noticing. The plugin's CHANGELOG.md has the same check in hooks/tests/run.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;
const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
const follows = [...changelog.matchAll(/^Follows (\d+\.\d+\.\d+) \(/gm)].map((m) => m[1]);

describe('Paddock changelog', () => {
  it('has an entry for the current version, first', () => {
    expect(versions[0], `package.json says ${version}; add a desk/CHANGELOG.md entry for it`).toBe(version);
  });

  it('names the release before each entry, by version and by what it did', () => {
    expect(follows).toHaveLength(versions.length - 1);
    follows.forEach((f, i) => expect(f, `${versions[i]} should follow ${versions[i + 1]}`).toBe(versions[i + 1]));
  });
});

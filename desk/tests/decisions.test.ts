import { describe, expect, it } from 'vitest';
import { composeApprovalNotes, decisionsComplete, parseDecisions } from '../src/renderer/decisions';

const packet = `# Review packet

## 1. TL;DR

Adds an audit log.

## 2. Decisions requested

| # | Decision | Recommendation | Alternative | If you choose the alternative |
|---|----------|----------------|-------------|-------------------------------|
| D1 | Retain logs for 7 years | Accept | 1 year | Re-check the regulator's minimum |
| D2 | Log to Postgres not files | Accept | Files | Nothing |
| | a row with no id is skipped | | | |

## 3. Evidence

| Check | Command |
|-------|---------|
| test | npm test |
`;

describe('parseDecisions', () => {
  it('reads id, decision, recommendation and alternative from the packet table', () => {
    expect(parseDecisions(packet)).toEqual([
      { id: 'D1', decision: 'Retain logs for 7 years', recommendation: 'Accept', alternative: '1 year' },
      { id: 'D2', decision: 'Log to Postgres not files', recommendation: 'Accept', alternative: 'Files' },
    ]);
  });

  it('returns nothing for a packet with no decisions section', () => {
    expect(parseDecisions('# Intent\n\n## Problem\n\nx\n')).toEqual([]);
  });

  it('accepts the brief and Ship document heading "## Decisions", as wh.js decisionItems does', () => {
    const brief = [
      '# Brief', '', '## Decisions', '',
      '| # | Decision | Recommendation | Alternative | Why |',
      '|---|----------|----------------|-------------|-----|',
      '| D1 | Pin Node to 22 | Accept | Leave floating | CI drift |',
      '', '## Your decision', '', 'Approve or reject.', '',
    ].join('\n');
    expect(parseDecisions(brief)).toEqual([
      { id: 'D1', decision: 'Pin Node to 22', recommendation: 'Accept', alternative: 'Leave floating' },
    ]);
    expect(parseDecisions(brief.replace('## Decisions', '### 3. Decisions requested'))).toHaveLength(1);
  });

  it('does not mistake a heading that merely mentions decisions for the table', () => {
    const md = '## Decisions we already made\n\n| D1 | x | y | z |\n';
    expect(parseDecisions(md)).toEqual([]);
  });
});

describe('decisionsComplete / composeApprovalNotes', () => {
  const items = parseDecisions(packet);

  it('needs a pick for every decision, and a note when the pick is "other"', () => {
    expect(decisionsComplete(items, {})).toBe(false);
    expect(decisionsComplete(items, { D1: { pick: 'recommendation', note: '' } })).toBe(false);
    expect(decisionsComplete(items, { D1: { pick: 'recommendation', note: '' }, D2: { pick: 'other', note: '' } })).toBe(false);
    expect(decisionsComplete(items, { D1: { pick: 'recommendation', note: '' }, D2: { pick: 'other', note: 'S3' } })).toBe(true);
  });

  it('writes one clause per decision starting with its id, then the free notes', () => {
    const notes = composeApprovalNotes(
      items,
      { D1: { pick: 'recommendation', note: '' }, D2: { pick: 'alternative', note: 'files are fine here' } },
      'ship it',
    );
    expect(notes).toBe('D1: recommendation accepted; D2: alternative chosen, files are fine here. ship it');
    expect(/\bD1\b/.test(notes) && /\bD2\b/.test(notes)).toBe(true); // what wh.js approve checks
  });
});

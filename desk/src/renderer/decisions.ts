/**
 * The "Decisions requested" table of a gate packet, and the notes an approval writes back.
 *
 * `wh.js approve` refuses an approval whose notes do not name every decision id, so the Gate
 * screen asks for each one before it lets the human approve. The parser mirrors
 * `decisionItems` in scripts/wh.js; keep the two in step.
 */
export interface DecisionItem {
  id: string;
  decision: string;
  recommendation: string;
  alternative: string;
}

export type DecisionPick = 'recommendation' | 'alternative' | 'other';

export interface DecisionChoice {
  pick: DecisionPick | null;
  note: string;
}

export function parseDecisions(markdown: string): DecisionItem[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}.*decisions requested/i.test(l));
  if (start < 0) return [];
  const items: DecisionItem[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^:?-{2,}/.test(cells[0])) continue;
    if (/^#$/.test(cells[0]) && /^decision$/i.test(cells[1] ?? '')) continue;
    if (!/^D\d+$/i.test(cells[0]) || !cells[1]) continue;
    items.push({
      id: cells[0].toUpperCase(),
      decision: cells[1],
      recommendation: cells[2] ?? '',
      alternative: cells[3] ?? '',
    });
  }
  return items;
}

/** True when every decision has a pick, and every "other" pick has a note saying what. */
export function decisionsComplete(items: DecisionItem[], choices: Record<string, DecisionChoice>): boolean {
  return items.every((d) => {
    const c = choices[d.id];
    if (!c || !c.pick) return false;
    return c.pick !== 'other' || c.note.trim() !== '';
  });
}

/** One clause per decision, each starting with its id (what wh.js checks for), then the free notes. */
export function composeApprovalNotes(
  items: DecisionItem[],
  choices: Record<string, DecisionChoice>,
  freeNotes: string,
): string {
  const clauses = items.map((d) => {
    const c = choices[d.id] ?? { pick: null, note: '' };
    const note = c.note.trim();
    const what =
      c.pick === 'recommendation' ? 'recommendation accepted'
      : c.pick === 'alternative' ? 'alternative chosen'
      : 'decided';
    return `${d.id}: ${what}${note ? `, ${note}` : ''}`;
  });
  const free = freeNotes.trim();
  return [clauses.join('; '), free].filter(Boolean).join('. ');
}

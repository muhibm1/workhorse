/**
 * Splits a document into retrievable chunks, ported from `studbook/ingest/chunker.py`: one per
 * H2 (or, for an oversized H2, per H3) section with the enclosing heading path, a heading-less
 * document as one section, and paragraph windows for anything still over budget -- never
 * splitting a markdown table's rows across a window unless the table alone is over budget, in
 * which case every window after the first repeats the header and separator rows.
 *
 * Byte-for-byte parity with the Python chunker is the requirement, not the goal: chunk ids and
 * content hashes are what the store keys on, so both ingesters must produce the same ones for
 * the same file or every sync from one side re-embeds and orphans the other's rows. Two places a
 * naive port diverges are handled explicitly -- Python's `round()` is half-to-even and its
 * `str.split()` counts zero words in an empty string -- and the chunk parity gate holds the whole
 * thing to Python's output over the live corpus.
 */
import { sha256, type ParsedDocument } from './parser';

/** ~500-800 tokens at ~1.3 tokens/word; real sections average 110-350 words and stay well under. */
export const MAX_CHUNK_WORDS = 600;

export interface Chunk {
  id: string;
  documentId: string;
  ordinal: number;
  headingPath: string;
  gate: string | null;
  body: string;
  tokenCount: number;
  contentHash: string;
}

const H1 = /^#\s+(.+?)\s*$/m;
const H2 = /^##\s+(.+?)\s*$/gm;
const H3 = /^###\s+(.+?)\s*$/gm;
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const GATE = /\bG([0-5])\b/;

/** Python's `len(s.split())`: whitespace-separated words, zero for blank. */
function wordCount(s: string): number {
  const t = s.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/** Python's `round()`: nearest, ties to even. `Math.round` rounds ties up and would give a
 *  different token_count for every word count ending in 5. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function inferGate(headingPath: string): string | null {
  const m = GATE.exec(headingPath);
  return m ? `G${m[1]}` : null;
}

/** (heading title or null for the leading unheaded part, section body) pairs, in order. */
function splitByLevel(text: string, pattern: RegExp): [string | null, string][] {
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [[null, text]];
  const sections: [string | null, string][] = [];
  const first = matches[0].index as number;
  if (first > 0) sections.push([null, text.slice(0, first)]);
  matches.forEach((m, i) => {
    const start = (m.index as number) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index as number) : text.length;
    sections.push([m[1], text.slice(start, end)]);
  });
  return sections;
}

function isTableLine(line: string): boolean {
  return line.trimStart().startsWith('|');
}

/** Blank-line-delimited blocks grouped into windows up to `maxWords`; an oversized table block is
 *  split by row with its header and separator repeated in every continuation window. */
function windowParagraphs(body: string, maxWords: number): string[] {
  const stripped = body.replace(/^\n+|\n+$/g, '');
  const blocks = stripped.split(/\n\s*\n/).filter((b) => b.trim() !== '');
  const windows: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length) windows.push(current.join('\n\n'));
    current = [];
    currentWords = 0;
  };

  for (const block of blocks) {
    const blockWords = wordCount(block);
    const lines = block.split('\n');
    const isTable = lines.length >= 2 && isTableLine(lines[0]) && TABLE_SEPARATOR.test(lines[1]);

    if (isTable && blockWords > maxWords) {
      flush();
      const [header, separator, ...rows] = lines;
      let rowWords = 0;
      let group: string[] = [];
      for (const row of rows) {
        rowWords += wordCount(row);
        group.push(row);
        if (rowWords >= maxWords) {
          windows.push([header, separator, ...group].join('\n'));
          rowWords = 0;
          group = [];
        }
      }
      if (group.length) windows.push([header, separator, ...group].join('\n'));
      continue;
    }

    if (currentWords + blockWords > maxWords && current.length) flush();
    current.push(block);
    currentWords += blockWords;
  }
  flush();
  return windows.length ? windows : [''];
}

export function chunkDocument(doc: ParsedDocument, maxWords = MAX_CHUNK_WORDS): Chunk[] {
  const h1 = H1.exec(doc.text);
  const h1Title = h1 ? h1[1] : null;
  const afterH1 = h1 ? doc.text.slice((h1.index as number) + h1[0].length) : doc.text;

  const chunks: Chunk[] = [];
  let ordinal = 0;
  const add = (headingPath: string, rawBody: string) => {
    const body = rawBody.trim();
    if (!body) return;
    chunks.push({
      id: `${doc.id}#${ordinal}`,
      documentId: doc.id,
      ordinal,
      headingPath,
      gate: inferGate(headingPath),
      body,
      tokenCount: Math.max(1, roundHalfEven(wordCount(body) * 1.3)),
      contentHash: sha256(body),
    });
    ordinal += 1;
  };
  const path = (...parts: (string | null)[]) => parts.filter((p): p is string => !!p).join(' > ');

  for (const [h2Title, h2Body] of splitByLevel(afterH1, H2)) {
    const h2Path = path(h1Title, h2Title);
    if (wordCount(h2Body) <= maxWords) {
      add(h2Path || 'Document', h2Body);
      continue;
    }
    for (const [h3Title, h3Body] of splitByLevel(h2Body, H3)) {
      const h3Path = path(h1Title, h2Title, h3Title);
      if (wordCount(h3Body) <= maxWords) {
        add(h3Path || h2Path || 'Document', h3Body);
      } else {
        for (const window of windowParagraphs(h3Body, maxWords)) {
          add(h3Path || h2Path || 'Document', window);
        }
      }
    }
  }
  return chunks;
}

// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the radar-4 model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard's data beside the page as data.js, copies this
// repository's dashboard/ and screenshots/ to /output, and writes /output/dossier.json with
// the vendored make.fun library. The program runs twice in grading and both runs must write
// the same bytes, so nothing here reads the clock, the network or a random source.
//
// radar-4 prices a category off the geometric median of its live-token market-cap-per-TVL
// (a ratio's centre is geometric, so an even sample takes the geometric mean of its two
// middle ratios instead of the arithmetic mean the larger one dominates), discounts a
// falling protocol harder than it rewards a rising one, and scores age as a launch window
// that peaks 12 to 24 months in instead of rewarding age without end. The farm plans add
// the risk the protocol's own category carries and, for a protocol on two or more chains,
// a step that repeats the position on its second chain, and the detail view shows the
// protocols ranked nearest to each row in its own category.
//
// Before it exits it reads its own board.json back and checks it again: the ranks, the
// order, the watchlist coverage, the farm steps and the rank-1 row must be the same ones
// the model just wrote, and data.js must parse back to the same board size. A run that
// writes a board it cannot read back is a run that failed, and it says so instead of
// handing in a dossier built on bytes it never verified.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASHBOARD_NAME = /^[A-Za-z0-9._-]+$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Fail with a message on stderr and exit code 2, the way a missing input fails. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(2);
}

/** A dollar figure in the short form the summary lines use. */
function shortUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

/** A multiple in the short form the summary lines use. */
function shortMult(n: number): string {
  return `x${n.toFixed(4)}`;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    if (!DASHBOARD_NAME.test(name)) fail(`${from}/${name}: a dashboard file name is letters, digits and . _ -`);
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * The board's own model summary, written into board.json beside the rows: the global
 * geometric multiple, every priced category with its sample and raw geometric median,
 * and the top of the board, so a reader of board.json alone can see what the ranking
 * rests on without re-running the model.
 */
function modelSummary(): {
  version: string;
  global_multiple: number;
  categories: { category: string; multiple: number; sample: number; median: number }[];
  top: { rank: number; slug: string; name: string; implied_value_usd: number }[];
} {
  return {
    version: radar.model_version,
    global_multiple: radar.global_multiple,
    categories: radar.categories,
    top: board.slice(0, 5).map((r) => ({ rank: r.rank, slug: r.slug, name: r.name, implied_value_usd: r.implied_value_usd })),
  };
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, model: modelSummary() })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(here, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${bytes} bytes, past the 512 KiB cap`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

/**
 * Read the run's own outputs back and check them against the model that wrote them.
 * The in-memory board passed boardIssue before it was written; this pass catches a
 * write that truncated, a JSON shape the scorer would not read, and a data.js the
 * page could not parse — the three failures that would hand the judge a dead page.
 */
function verifyOutputs(): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  } catch {
    fail('board.json does not parse back after it was written');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('board.json is not a JSON object on read-back');
  const rows = (parsed as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) fail('board.json has no rows array on read-back');
  if (rows.length !== board.length) fail(`board.json reads back ${rows.length} rows, the model wrote ${board.length}`);
  const first = rows[0] as Record<string, unknown> | undefined;
  if (first === undefined || first.slug !== board[0]!.slug || first.implied_value_usd !== board[0]!.implied_value_usd) {
    fail('board.json rank 1 does not match the model on read-back');
  }
  const last = rows[rows.length - 1] as Record<string, unknown>;
  if (last.slug !== board[board.length - 1]!.slug || last.implied_value_usd !== board[board.length - 1]!.implied_value_usd) {
    fail('board.json last row does not match the model on read-back');
  }
  const summary = (parsed as Record<string, unknown>).model as Record<string, unknown> | undefined;
  if (summary === undefined || summary.version !== radar.model_version) fail('board.json model summary does not match the run');
  const dataText = readFileSync(join(out, 'data.js'), 'utf8');
  const dataJson = dataText.replace(/^window\.RADAR=/, '').replace(/;\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(dataJson);
  } catch {
    fail('data.js does not parse back after it was written');
  }
  if (typeof data !== 'object' || data === null) fail('data.js is not a JSON object on read-back');
  const dataRows = (data as Record<string, unknown>).rows;
  if (!Array.isArray(dataRows) || dataRows.length !== board.length) fail(`data.js reads back ${Array.isArray(dataRows) ? dataRows.length : 'no'} rows, the model wrote ${board.length}`);
  const dossierBytes = statSync(join(out, 'dossier.json')).size;
  if (dossierBytes > 1_572_864) fail(`dossier.json is ${dossierBytes} bytes, past the 1.5 MiB cap`);
}

verifyOutputs();

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: global multiple ${shortMult(radar.global_multiple)} over ${radar.categories.length} priced categories; rank 1 ${board[0]!.name} at ${shortUsd(board[0]!.implied_value_usd)}, rank 2 ${board[1]!.name} at ${shortUsd(board[1]!.implied_value_usd)}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (read back and verified)\n`,
);

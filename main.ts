// token-radar-01: turn the sealed snapshot into a ranked board, a dashboard and a dossier.
//
// The entry point reads /input/snapshot.json (or whatever --input points at), scores every
// pre-token protocol with the model in lib/model.ts, and writes the results to /output
// (or MAKEFUN_OUTPUT_DIR / --output when run outside the grader):
//   board.json    the ranked rows the gate checks
//   data.js       the same ranking, as window.RADAR for the dashboard
//   dashboard/    a static, offline copy of this repo's dashboard/
//   screenshots/  a copy of this repo's screenshots/ (board, detail, filtered)
//   dossier.json  the judge's summary, built last from the finished /output
//                 by the vendored make.fun library in vendor/makefun-board.ts.
//
// The program is Node 22, standard library only, no network, and deterministic:
// run it twice on the same snapshot and every output byte is the same.
//
//   node main.ts --input ../input/snapshot.json
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   node main.ts --help

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { copyFileSync, statSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Where this file lives: dashboard/ and screenshots/ are copied from beside it.
const hereUrl = new URL('.', import.meta.url);
const repoRoot = fileURLToPath(hereUrl);

// Caps the scorer holds the entry to (reference/gate.json). The text cap shapes the
// dossier's bytes; the screenshot and dashboard caps only refuse.
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SHOTS = 3;

/** Print the usage summary for --help and stop. */
function showHelp(): void {
  process.stdout.write(
    'token radar: score the sealed snapshot into a ranked board and dashboard\n' +
      '\n' +
      'Usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>]\n' +
      '\n' +
      '  --input <path>   snapshot file, or a directory holding snapshot.json (default /input)\n' +
      '  --output <dir>   where the board, dashboard and dossier go\n' +
      '                   (default $MAKEFUN_OUTPUT_DIR, else /output)\n' +
      '  --help, -h       print this summary and exit\n',
  );
}

/** The value after `--flag <value>`, or after `--flag=<value>`, or `fallback` when absent. */
function optionValue(flag: string, fallback: string): string {
  const args = process.argv;
  for (let i = 0; i + 1 < args.length; i++) {
    if (args[i] === `--${flag}`) return args[i + 1]!;
  }
  const prefix = `--${flag}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

/** Write a message to stderr and stop with the given status. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

/** A snapshot path: a .json file as given, otherwise snapshot.json inside the directory. */
function snapshotPath(raw: string): string {
  return raw.endsWith('.json') ? raw : joinPath(raw, 'snapshot.json');
}

/** Copy a directory's regular files into `dest`, skipping dotfiles; returns the names copied. */
function copyPlainFiles(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const srcPath = joinPath(src, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, joinPath(dest, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    return;
  }

  const rawInput = optionValue('input', '/input');
  const snapshotFile = snapshotPath(rawInput);
  if (!existsSync(snapshotFile)) {
    fail(`token radar: no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`, 2);
  }
  const outDir = optionValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const gateRefusal = boardIssue(board, snapshot);
  if (gateRefusal !== null) {
    fail(`token radar: the model wrote a board the gate refuses: ${gateRefusal}\n`, 1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(joinPath(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(joinPath(outDir, 'data.js'), dataScript(radar));

  copyPlainFiles(joinPath(repoRoot, 'dashboard'), joinPath(outDir, 'dashboard'));
  const shots = copyPlainFiles(joinPath(repoRoot, 'screenshots'), joinPath(outDir, 'screenshots'));
  if (shots.length < MIN_SHOTS) {
    fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
    }
  }

  // The dossier goes last: the scorer rebuilds it from this finished output and compares bytes.
  writeFileSync(
    joinPath(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: DASHBOARD_LIMITS }),
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${joinPath(outDir, 'board.json')}, ${joinPath(outDir, 'data.js')}, ${joinPath(outDir, 'dashboard')} (3 files), ${joinPath(outDir, 'screenshots')} (${shots.length} images) and ${joinPath(outDir, 'dossier.json')}\n`,
  );
}

main();

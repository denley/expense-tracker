# Expense tracker — agent notes

Household expense tracker (see `README.md` for features). React app + a small Node server that owns the
data folder. Deployment details for the home server it runs on are in `.agents/deployment.md` when this
checkout is deployed (a symlink created by the deploy script; gitignored). This repo is public: keep
hostnames, logins and anything about the deployment out of it.

To work on the household's actual data (import, categorise), use the running server's API, described in
the data folder's `README.md` (`server/readme.ts`), not this repo.

## Layout

- `client/src/lib/` — shared with the server, so no DOM or Node APIs here (except `api.ts`, `sync.ts`,
  `db.ts`, `download.ts`, which are client-only):
  `files.ts` (the data files: names, (de)serialization, validation, normalization), `tree.ts` (category tree,
  path resolution), `csv.ts` (bank CSV parsing and import detection), `rules.ts`, `export.ts`
  (transactions.csv + JSON backup format), `types.ts`.
- `client/src/lib/api.ts` + `sync.ts` — server client and the per-file sync engine.
  `contexts/ExpenseContext.tsx` — the app's store: four `FileSync`s plus derived analytics.
- `server/` — `main.ts` (config, routes, SSE), `store.ts` (the single writer of the data folder),
  `ops.ts` (agent API operations, pure), `summarize.ts` (diff → activity summary), `activity.ts`,
  `backups.ts` (snapshots + retention), `http.ts` (identity, bodies, static), `readme.ts` (data folder README).
  Bundled by esbuild into `server/dist/main.mjs` with no runtime dependencies.

## Invariants — keep these

- **The CSV files are the source of truth** and stay hand-editable: header rows, stable `ID`/`Id`
  values, `\n` line endings, derived columns (`Path`) are rewritten on save, structure lives in `ParentId`.
  Schema changes must stay readable by older code paths or come with a migration in `files.ts`.
- **The server is the only regular writer.** App writes are whole-file PUTs against the file's revision
  (content hash); a stale revision is a 409 and the app replays its queued updaters onto the server's copy.
  So every mutation in `ExpenseContext` must be a replayable updater over the latest copy (id-based, never
  index-based, safe to apply twice), and values returned to callers are computed from the current view.
- **Never treat "couldn't read" as "empty".** An unparseable transactions.csv blocks mutations (app and
  API) instead of loading as zero rows; the server validates every write (`validateFile`).
- **Every change is attributed and logged**, whoever makes it: the store diffs old vs new content
  (`summarize.ts`), so a new write path gets an activity entry for free if it goes through `Store.commit`.
- **Agent operations are pure** (`ops.ts`: parsed workspace in, changes + undo recipe out) and reuse the
  app's own import/dedup/rule logic, so an API import behaves like the dialog. Undo only reverts rows still
  in the state the operation left them in.
- **Snapshot before anything destructive** (imports, uploads, restores, direct file edits) and before each
  day's first change.
- Identity comes from `tailscale serve` headers; direct (loopback) requests are local agents. Don't add
  accounts or passwords.

## Workflow

- `pnpm dev:server` (point `DATA_DIR` at a scratch folder) + `pnpm dev`; `pnpm test`; `pnpm build`.
- Never point a dev server at the production data folder.
- Development and deployment both run from `main`; see `.agents/deployment.md` for how it's deployed.

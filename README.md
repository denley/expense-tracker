# Household Expense Tracker

A file-first web app for tracking, categorising and visualising household spending. Built with React, TypeScript, Tailwind CSS, and Recharts.

**Your data is a folder of plain CSV files on your disk** — the app (Chrome/Edge desktop, via the File System Access API) is just a viewer/editor over them. Point any tool, script, or AI agent straight at the folder; the app picks up external edits automatically when its tab regains focus. Put the folder in git or a synced drive for durability.

## The data folder

On first load the app asks you to choose a folder. It reads and writes:

| File | Contents |
|---|---|
| `transactions.csv` | `ID,Date,Description,Amount,Category,Group,Account,Notes` |
| `categories.csv` | `Category,Group` — the tree; authoritative for each transaction's Group |
| `projects.csv` | `Name,Color,Status,Budget,Notes,CreatedAt` — `Status: archived` retires a project |
| `rules.csv` | `Pattern,IsRegex,Category,Enabled,CreatedAt` — auto-categorisation |
| `import-profiles.json` | saved bank CSV column mappings (app-managed) |
| `README.md` | schema documentation, written for AI agents (auto-created) |

Conventions: dates ISO `yyyy-mm-dd`; amounts positive = expense, negative = income/refund; keep `ID` values unchanged; files use Unix `\n` line endings. Avoid editing files while actively clicking around the app (writes are last-one-wins) — finish the edit, then refocus the app tab.

## The model

Money is broken down into one strict tree, so every chart partitions cleanly:

- **Group** — the pie-chart bucket ("where did my money go?"): Groceries, Home, Travel…
- **Category** — the fine-grained label inside a group: Dining Out, Electric/Gas, Flights…
- **Project** — a one-off cost centre (a trip, a renovation, a baby). A project **is a group** with metadata attached: budget, color, archive status. Its categories ("Japan Trip 2026 → Food / Flights / Accommodation") and totals appear in every chart alongside ongoing groups. When it's over, **archive it**: its categories drop out of pickers and suggestions, rules pointing at it are disabled, and all history stays intact (the active period is implicit from its transactions).

Every transaction has exactly one category, and every category belongs to exactly one group. Nothing double counts.

## Features

### Track & edit
- **Transactions** — filter by search / category / group / account / date range, sort, multi-select (shift-click for ranges), bulk categorise, bulk delete, inline row editing, manual entry
- **CSV Import** — drop any bank export; columns, date format (DMY/MDY/ISO) and sign conventions are auto-detected. Column mappings save as reusable bank profiles that auto-apply when a matching file is dropped. Duplicate rows (same date + amount + description) are detected and skipped. Optionally categorise a whole import at once (e.g. a travel-card statement into a project category)
- **Projects** — create with starter categories and a budget; budget progress bars, per-project charts, archive/restore lifecycle
- **Categories & Groups** — rename (rename-into-existing = merge), move categories between groups, delete with reassignment, all with live transaction counts
- **Rules** — "description contains X → category" (group follows), applied automatically on import or on demand. The app suggests rules by finding merchants that always land in the same category

### Analyse
- **Dashboard** — KPI cards, monthly trend, group doughnut (projects appear as slices in their own color), top categories, cumulative spend, active project budget snapshot
- **Categories / Monthly / Trends** — deep-dive pages with interactive cross-navigation
- **Compare** — any two periods (year, month, or custom range) side by side, with year-over-year presets: totals and per-day averages, aligned month-by-month bars, a cumulative spend race, a per-group delta table with category drill-down, and GitHub-style calendar heatmaps on a shared colour scale
- **Year scope** — a global selector (all time / per year) once data spans multiple years

### Own your data
- The folder is the source of truth — edit it with anything, no export/import loop needed
- **Backup snapshots** — one-click CSV or full JSON backup downloads, with JSON restore
- Data from the previous in-browser (IndexedDB) version is migrated automatically into the first empty folder you connect

## Development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

Output is in `dist/`. Deployed to GitHub Pages via `.github/workflows/deploy.yml`.

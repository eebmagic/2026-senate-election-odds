# Working in this repo

Architecture, data pipeline, and UI overview live in `README.md` — read that
first. This file is about *how* to work here: version control, the
feedback-review workflow, local verification, and gotchas hit in practice.

## Version control: GitButler (`but`), not raw git

This repo is managed with GitButler. Load the `gitbutler` skill before doing
any branch/commit/push/PR work, and use `but` for every write operation —
never raw `git add`/`commit`/`push`/`checkout`/`branch` (read-only commands
like `git log` are fine). If `but` reports "Not currently on a
gitbutler/*branch", run `but setup` to get back into the managed workspace
before continuing.

Before starting new work, `but pull` to sync the workspace with `origin/main`
— other branches land independently and often (this repo merges PRs
frequently), and stale-module-cache issues (see below) are easier to
misdiagnose against an out-of-date base.

**Branch naming:** `<topic>/<short-description>`, where `<topic>` is a
shortened form of the relevant `feedback/*.md` file's name (drop a leading
qualifier word, keep the distinctive one): `color-and-contrast.md` →
`contrast/`, `responsive-layout.md` → `layout/`, `legend-and-symbols.md` →
`symbols/`, `map-and-interactivity.md` → `interactivity/`,
`content-clarity.md` → `clarity/`, `tooltips.md` → `tooltips/`. One
branch/PR per feedback item (or a tight cluster of directly-related
follow-ups) — don't bundle unrelated items onto one branch.

My preferred process is to have each claude session map pretty cleanly to a single gitbutler branch. There may be exceptions, when relevant check with me if a change should be a new branch.

**PRs:** `but push <branch>` then `but pr new <branch> -m $'Title\n\nBody'`.
Always pass an explicit `-m` — `-t` (default title) falls back to the raw
branch name for any branch with more than one commit, which is nearly always.
Write the PR body as a real description: what changed, why, and concretely
where/how to observe it in the UI (which cell/state to hover, what width to
resize to, etc.).

**`but pr` cannot edit an existing PR's title/description** — there's no
`but pr edit`/`update` command, only `new` (no-ops harmlessly if a PR already
exists for that branch — it won't touch the existing title/body, verify via
the GitHub API if you need to confirm), `auto-merge`, `set-draft`,
`set-ready`, `template`. Use `gh` for that instead — it *is* installed and
authed (`gh pr edit <n> --repo eebmagic/2026-senate-election-odds --title ...
--body-file ...`). Prefer `--body-file` over `--body` so the markdown survives
the shell intact. Editing a PR modifies public content, so ask before the
first edit of a given PR rather than rewriting a description unprompted.

**Merging to `main` deploys live** — `.github/workflows/deploy-pages.yml`
auto-publishes `web/**` to GitHub Pages on every push to `main`. Treat a PR
merge as a production deploy: verify in the browser before considering an
item done, not just via code review.

## Tracking work items (Obsidian Kanban)
There is a linked dir: senate-election-map-kanban/
This dir is a symlink to a folder in my obsidian repo.
You should ONLY edit/add files in this folder, nothing else in my obsidian files.
The `Senate Election Map.md` is a kanban board which tracks the state of workitems, as well as links to the work items.
The works items are individual files in the `task-items/` subdir.
In a board entry `[[File Name|Display Text]]`, the text before the `|` is
the filename in `task-items/` (add `.md`); the rest is just a label.
An item's status is the column heading it sits under, *not* the
`- [ ]`/`- [x]` checkbox — Rejected items are unchecked too.
Each of these should hopefully map to a specific branch + PR.
If you are working an item that already has a file, then add a note on the file branch and PR when they are each created.
When the PR is created (or when it is generally ready for review) then you can move it to the Review list/column.
When PRs are merged and you find that the item is not marked as DONE, then feel free to progress the item in the kanban.

**Don't create new task items unless I explicitly ask.** Updating existing
items is fine (branch/PR notes, column moves). If work doesn't match any
existing item, just say so — don't file one for it.

This is what the structure of that dir looks like:
```bash (truncated tree)
senate-election-map-kanban
├── Senate Election Map.md
└── task-items
    ├── Alaska Ranked-Choice Process.md
    ├── Bundle Size Optimization.md
    ...
```

## Running & verifying locally

`cd web && python3 -m http.server` (or similar — no build step). Verify UI
changes live via the claude-in-chrome browser tools (screenshot/zoom/hover),
not just by reading the diff. If the extension isn't connected
(`list_connected_browsers` returns `[]`), that's an environment issue for the
user to fix, not a reason to skip verification — mark the item ⚠️ with that
reason rather than claiming success from code review alone.

**Known gotcha — stale ES module cache:** after editing a `.js` file, the
browser sometimes keeps serving a cached module and throws a stale
`SyntaxError` / missing-export error even though the file on disk is already
correct (confirm with `curl localhost:8000/<file>`). Hard-reload
(Cmd+Shift+R) rather than assuming the edit is broken.

**Known gotcha — `resize_window` doesn't affect `window.innerWidth`** in this
Chrome automation environment, so it can't be used to test the responsive
breakpoints in `web/index.html`. Instead, serve a small local iframe harness
(a second `python3 -m http.server` on a scratch directory, with
`<iframe src="http://localhost:8000" style="width:390px">` or whatever width
you need) and navigate to that.

**Concurrent edits:** when multiple agents work in this workspace at once,
always re-run `but diff` immediately before each commit and commit only the
specific hunk IDs that are actually yours — never commit a whole file
blindly, and never discard/revert a hunk you don't recognize.

**Never commit** `note.md` / `.note.md.swp` — the user's personal scratch
notes, explicitly marked not to be tracked.

## Backend: the Kalshi data pipeline (`script.py`)

Full architecture is in `README.md`'s "Rebuild logic" — this is the
practical stuff hit while working on it.

- `script.py` fetches from Kalshi and writes `web/live-senate-data.json`
  directly (in-memory transform via `scripts/build_live_data.build()`) —
  there's no intermediate raw-dump file. `scripts/build_live_data.py` still
  runs standalone (`--input`/`--previous`/`--output`) for rebuilding from a
  manually saved dump.
- `live_data_snapshots/` is a **tracked** (not gitignored) per-run audit
  trail, pruned on disk to the newest N each run (`--keep-snapshots`,
  default 100). A commit that includes it needs to stage deletions too —
  `git add -A web/live-senate-data.json live_data_snapshots/`, not just the
  single live-data file, or pruned files linger tracked in git.
- If more than 25% of tickers fail a run, `script.py` deliberately leaves
  `web/live-senate-data.json` on the previous good run instead of
  overwriting it with mostly-stale data (the snapshot is still written, for
  debugging). Read "the live file didn't change" as that gate tripping, not
  the script being broken — check the run's own failure-rate output first.
- Before running `script.py` against the real repo paths, check `git
  status`/`but status` for uncommitted changes to `web/live-senate-data.json`
  — other agents' in-progress UI work can be mid-edit on that exact file.
  Validate first with `--output`/`--snapshot-dir` pointed at a scratch path
  (real network calls, no risk to the tracked file), then only point at the
  real defaults once the working tree is confirmed clear there.
- Kalshi quirk baked into `scripts/event_ticker_map.json`: the
  `SENATELA-26` event ticker actually carries **Kentucky's** markets (a
  labeling bug on Kalshi's side); real Louisiana is `KXSENATELA-26NOV`.
  Don't "fix" this if it looks wrong — it's deliberate and confirmed live.
- Independent-candidate ticker suffixes aren't a fixed convention (seen so
  far: `TACH`, `IND`, `DOSB`, `BBEN` across different races) — don't
  hardcode them; `build_race()`'s "anything that isn't `-D`/`-R` is an
  other-ticker" fallback is the correct approach.
- Both scripts are stdlib-only (no `requirements.txt`, no venv) — keep it
  that way unless there's a real reason not to; it's what makes this easy to
  drop into a cron job or GitHub Actions runner later.

## Shared code to know about

- `web/senate-shared.js` — the single source of truth for colors
  (`COLORS`), thresholds, `SOLID_SEATS`, `STATE_NAMES`, and the
  probability/formatting helpers (`fmtPct`, `colorForDemProb`, ...) used by
  both `app.js` (seat-bar) and `map.js` (choropleth). Add shared constants
  here, not duplicated in either consumer.
- Both `app.js` and `map.js` build their *own* tooltip HTML
  (`tooltipHtml()` in each) but share one `.tooltip` CSS component in
  `index.html` (`#tooltip-wide`/`#tooltip-narrow` for the seat bar,
  `#map-tooltip` for the map). A shared-CSS change affects all three; a
  content/behavior change needs to be made in each file's own
  `tooltipHtml()`/positioning logic separately, unless it's worth factoring
  into `senate-shared.js`.
- `app.js`'s wide and narrow seat-bar layouts are both built up front and
  toggled by a CSS media query (not a resize listener) — see the README.

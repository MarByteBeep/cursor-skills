# finalize

Quality loop for Cursor: optional supabase:types preflight → format → CI → Fallow until green. Status style is set at postinstall (`communication`: caveman or brief).

## Install skill (once per machine)

```bash
npx skills add MarByteBeep/cursor-skills --list
```

Pick **one** invoker chain (do not mix). Chain `postinstall.mjs` right after install — the skills CLI has no native post-install hook yet ([vercel-labs/skills#1155](https://github.com/vercel-labs/skills/issues/1155)):

| Machine has `bun` | Install + postinstall (once per repo) |
|-------------------|---------------------------------------|
| Yes | `bunx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && bun .agents/skills/finalize/scripts/postinstall.mjs` |
| No | `npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && node .agents/skills/finalize/scripts/postinstall.mjs` |

Use `--copy` if Cursor does not pick up symlinked skills.

## Project postinstall (once per repo)

From the repo root:

```bash
bun .agents/skills/finalize/scripts/postinstall.mjs    # if bun on PATH
# or
node .agents/skills/finalize/scripts/postinstall.mjs
```

Interactive prompts (like `bun init`):

- Install **caveman** skill in this project for terse status updates? (default yes; no → `communication: "brief"`)
- Include **supabase:types** preflight? (writes `src/integrations/supabase/types.ts`, or `apps/<app>/…` in monorepos; always asked interactively — default yes if `supabase/config.toml` exists, else no)
- Add missing devDependencies (`@biomejs/biome`, `fallow`)?
- Add or overwrite finalize scripts (`format`, `check:ci`, `check:fallow`, and `supabase:types` when preflight is on)?
- Add missing config templates, or overwrite conflicting ones (`biome.json`, `.fallowrc.json`, `.cursor/rules/fallow.mdc`)?

**All-or-nothing:** postinstall exits with an error if you decline anything required — missing devDependencies, missing scripts, missing config, or config conflicts you refuse to overwrite. It never writes `pipeline.json` after a partial setup (no scripts without deps, no pipeline without Fallow config).

Templates live in `skills/finalize/templates/` (sourced from [ftm-polarsteps](https://github.com/MarByteBeep/ftm-polarsteps)). Fallow `entry` paths are detected from the repo (`src/main.tsx`, `apps/*`, `packages/*`); other `.fallowrc.json` fields come from the finalize template.

After a successful postinstall, `scripts/` and `templates/` under `.agents/skills/finalize/` are removed — postinstall is one-time; the pipeline lives in `pipeline.json`. Re-run requires reinstalling the skill and `--force`. Postinstall materializes placeholders in `SKILL.md` and `.cursor/rules/fallow.mdc`.

Finalize **owns** these `package.json` script names: `format`, `check:ci`, `check:fallow`, and `supabase:types` (when preflight is on). Existing scripts with the same name but different commands must be overwritten (prompt, or `-y`).

Finalize **owns** these config files: `biome.json`, `.fallowrc.json`, `.cursor/rules/fallow.mdc`. Missing files are added; existing files that differ from finalize templates trigger an overwrite prompt (or `-y`). Only `.fallowrc.json` `entry` is project-specific.

**Package manager:** detected from `package.json` `"packageManager"` (must be `"bun"` or `"npm"` — `pnpm`/`yarn` fail explicitly), else lockfile (`bun.lock` / `package-lock.json`), else PATH. Unsupported or missing tools fail before any writes.

Non-interactive:

```bash
bun .agents/skills/finalize/scripts/postinstall.mjs -y
bun .agents/skills/finalize/scripts/postinstall.mjs --supabase -y
bun .agents/skills/finalize/scripts/postinstall.mjs --no-supabase -y
bun .agents/skills/finalize/scripts/postinstall.mjs --no-caveman -y
bun .agents/skills/finalize/scripts/postinstall.mjs --dry-run
```

(Use `node` instead of `bun` when bun is not on PATH.)

`-y` defaults: supabase:types preflight on if `supabase/config.toml` exists; caveman install on; accept all required deps, scripts, and config.

Postinstall order: install deps → write scripts/config → write `pipeline.json` → materialize skill files → install caveman (optional) → remove init assets. Caveman runs last so a pipeline write failure does not leave caveman installed without a valid pipeline.

## Pipeline (`.agents/skills/finalize/pipeline.json`)

Postinstall writes this file. **`/finalize` reads it only** — derives `{packageManager} run {script}` at runtime.

Example (bun, with Supabase preflight):

```json
{
	"communication": "caveman",
	"packageManager": "bun",
	"preflight": ["supabase:types"],
	"loop": ["format", "check:ci", "check:fallow"]
}
```

Without Supabase:

```json
{
	"communication": "brief",
	"packageManager": "npm",
	"preflight": [],
	"loop": ["format", "check:ci", "check:fallow"]
}
```

| Field | Purpose |
|-------|---------|
| `communication` | `"caveman"` or `"brief"` |
| `packageManager` | `"bun"` or `"npm"` — used to build run commands |
| `preflight` | Script names run at the start of every `/finalize`, in order (`[]` when none) |
| `loop` | Script names in order; `"check:fallow"` uses the fallow inner loop |

Re-run postinstall after changing scripts or Supabase setup — reinstall the skill first:

```bash
bunx skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && bun .agents/skills/finalize/scripts/postinstall.mjs
```

(Use `node` instead of `bun` when the project has `"packageManager": "npm"`.)

Commit `.agents/skills/finalize/pipeline.json` so the team shares the same pipeline.

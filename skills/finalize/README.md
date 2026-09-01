# finalize

Quality loop for Cursor: optional Supabase types → format → CI → Fallow until green. Status style is set at postinstall (`communication`: caveman or brief).

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
- Include Supabase types bootstrap? (writes `src/integrations/supabase/types.ts`, or `apps/<app>/src/integrations/supabase/types.ts` in monorepos)
- Add missing devDependencies (`@biomejs/biome`, `fallow`)?
- Add finalize scripts (`format`, `check:ci`, `check:fallow`)?
- Add config templates (`biome.json`, `.fallowrc.json`) if missing?

Templates live in `skills/finalize/templates/` (sourced from [ftm-polarsteps](https://github.com/MarByteBeep/ftm-polarsteps)). Postinstall never overwrites existing config files. Fallow `entry` paths are detected from the repo (`src/main.tsx`, `apps/*`, `packages/*`).

After a successful postinstall, `scripts/` and `templates/` under `.agents/skills/finalize/` are removed — postinstall is one-time; the pipeline lives in `pipeline.json`.

Non-interactive:

```bash
bun .agents/skills/finalize/scripts/postinstall.mjs -y
bun .agents/skills/finalize/scripts/postinstall.mjs --supabase -y
bun .agents/skills/finalize/scripts/postinstall.mjs --no-supabase -y
bun .agents/skills/finalize/scripts/postinstall.mjs --no-caveman -y
bun .agents/skills/finalize/scripts/postinstall.mjs --dry-run
```

(Use `node` instead of `bun` when bun is not on PATH.)

`-y` defaults: Supabase bootstrap on if `supabase/config.toml` exists; caveman install on.

## Pipeline (`.agents/skills/finalize/pipeline.json`)

Postinstall writes this file. **`/finalize` reads it only** — no bun/node/npm decisions at runtime.

| Field | Purpose |
|-------|---------|
| `communication` | `"caveman"` (load caveman skill) or `"brief"` (short updates, no caveman) |
| `bootstrap.command` | Run once before the loop (e.g. Supabase type gen) |
| `loop[].command` | Run in order for each outer pass (Fallow entry: package-manager run of `check:fallow`) |
| `loop[].phase` | `"format"`, `"ci"`, or `"fallow"` — `"fallow"` identifies the inner-loop entry |
| `loop[].script` | Package.json script name; Fallow entry must be `"check:fallow"` |
| `loop[].innerLoop` | Required `true` on the Fallow entry only; must not appear on other entries |
| `packageManager`, `scriptsRunner`, `postinstallInvoker` | Metadata for humans / re-run; not used by `/finalize` loop |

Re-run postinstall after changing `package.json` scripts or Supabase setup — reinstall the skill first:

```bash
<skills invoker from pipeline> skills add MarByteBeep/cursor-skills --skill finalize -a cursor --copy -y && \
  <postinstallInvoker from pipeline> .agents/skills/finalize/scripts/postinstall.mjs
```

Commit `.agents/skills/finalize/pipeline.json` so the team shares the same pipeline.

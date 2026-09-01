# finalize

Quality loop for Cursor: optional Supabase types → format → CI → Fallow until green. Status style is set at init (`communication`: caveman or brief).

## Install skill (once per machine)

```bash
npx skills add MarByteBeep/cursor-skills --list
```

Pick **one** invoker chain (do not mix):

| Machine has `bun` | Install skill | Run init |
|-------------------|---------------|----------|
| Yes | `bunx skills add MarByteBeep/cursor-skills --skill finalize -a cursor -g --copy -y` | `bun scripts/init.mjs` |
| No | `npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor -g --copy -y` | `node scripts/init.mjs` |

Use `--copy` if Cursor does not pick up symlinked skills.

## Project init (once per repo)

From the repo root:

```bash
bun ~/.cursor/skills/finalize/scripts/init.mjs    # if bun on PATH
# or
node ~/.cursor/skills/finalize/scripts/init.mjs
```

Interactive prompts (like `bun init`):

- Install **caveman** skill for terse status updates? (default yes; no → `communication: "brief"`)
- Include Supabase types bootstrap? (writes `src/integrations/supabase/types.ts`, or `apps/<app>/src/integrations/supabase/types.ts` in monorepos)
- Add missing devDependencies (`@biomejs/biome`, `fallow`)?
- Add finalize scripts (`format`, `check:ci`, `check:fallow`)?

Non-interactive:

```bash
bun ~/.cursor/skills/finalize/scripts/init.mjs -y
bun ~/.cursor/skills/finalize/scripts/init.mjs --supabase -y
bun ~/.cursor/skills/finalize/scripts/init.mjs --no-supabase -y
bun ~/.cursor/skills/finalize/scripts/init.mjs --no-caveman -y
bun ~/.cursor/skills/finalize/scripts/init.mjs --dry-run
```

(Use `node` instead of `bun` when bun is not on PATH.)

`-y` defaults: Supabase bootstrap on if `supabase/config.toml` exists; caveman install on.

## Pipeline (`.cursor/finalize-pipeline.json`)

Init writes this file. **`/finalize` reads it only** — no bun/node/npm decisions at runtime.

| Field | Purpose |
|-------|---------|
| `communication` | `"caveman"` (load caveman skill) or `"brief"` (short updates, no caveman) |
| `bootstrap.command` | Run once before the loop (e.g. Supabase type gen) |
| `loop[].command` | Run in order for each outer pass (Fallow entry: package-manager run of `check:fallow`) |
| `loop[].phase` | `"format"`, `"ci"`, or `"fallow"` — `"fallow"` identifies the inner-loop entry |
| `loop[].script` | Package.json script name; Fallow entry must be `"check:fallow"` |
| `loop[].innerLoop` | Required `true` on the Fallow entry only; must not appear on other entries |
| `packageManager`, `scriptsRunner`, `initInvoker` | Metadata for humans / re-init; not used by `/finalize` loop |

Re-init after changing `package.json` scripts or Supabase setup:

```bash
<initInvoker from pipeline> ~/.cursor/skills/finalize/scripts/init.mjs
```

Commit `.cursor/finalize-pipeline.json` so the team shares the same pipeline.

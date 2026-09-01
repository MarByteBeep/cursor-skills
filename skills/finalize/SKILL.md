---
name: finalize
description: >
  Continuous quality fix loop. Reads .agents/skills/finalize/pipeline.json (from finalize postinstall).
  Runs every script in pipeline.preflight[], then repeatedly executes all configured loop[] phases according to their loop semantics until the pipeline is green.
  Communication style follows pipeline.communication ({{communication}}). Use only when the user
  invokes /finalize.
---

# Finalize: continuous quality fix loop

Ensure the codebase passes all checks defined in **`.agents/skills/finalize/pipeline.json`**.

The skill is **complete only when every loop step passes consecutively with exit code 0**.

## Prerequisites (postinstall)

`/finalize` assumes postinstall completed successfully — it is **all-or-nothing**. Declining required devDependencies, scripts, or config (or refusing to overwrite conflicting finalize-owned config) exits postinstall with an error; no `pipeline.json` is written.

Required in the repo:

| Artifact | Purpose |
|----------|---------|
| `@biomejs/biome`, `fallow` (devDependencies) | `format`, `check:ci`, `check:fallow` scripts |
| `format`, `check:ci`, `check:fallow` in `package.json` | Loop steps (finalize-owned names) |
| `biome.json`, `.fallowrc.json`, `.cursor/rules/fallow.mdc` | Lint/format and Fallow gates (finalize-owned; `.fallowrc.json` `entry` is project-specific) |
| `.agents/skills/finalize/pipeline.json` | Frozen pipeline for this project |

If any of these are missing or mismatched, tell the user to re-run postinstall (reinstall skill first if templates were removed). See [README](README.md).

## Load and validate pipeline (start of every /finalize)

1. Read **`.agents/skills/finalize/pipeline.json`** at repo root.
2. If missing → stop. Tell the user to install the finalize skill and run postinstall once (see [README](README.md)).
3. Parse JSON. If invalid → stop and report the parse error.
4. Validate before running anything:

| Check | On failure |
|-------|------------|
| `packageManager` is `"{{packageManager}}"` | Stop — pipeline package manager mismatch |
| `loop` exists and is a non-empty array of non-empty strings | Stop — pipeline has no runnable steps |
| `preflight` exists and is an array; each entry is a non-empty string | Stop — invalid preflight |
| `communication` is `"{{communication}}"` | Stop — pipeline communication mismatch |
| `check:fallow` is the final `loop[]` entry (exactly once) | Stop — invalid Fallow step |

**Fallow invariant:** `"check:fallow"` is always the **last** `loop[]` entry and uses the **fallow inner loop** (see below).

5. For each **`script`** in `preflight[]` (in order) → run **`{{packageManager}} run {script}`** at the start of this `/finalize`.
6. For each **`script`** in `loop[]`, run **`{{packageManager}} run {script}`** in order. Apply inner-loop semantics to `"check:fallow"` (see below).

## Command execution (pipeline only)

These rules apply **only** to pipeline preflight and loop invocations.

| Do | Don't |
|----|-------|
| `{{packageManager}} run {script}` — script from pipeline | Other invokers, renamed scripts, or bare `bun`/`npm` without `run` |
| One command per shell call | `cd`, `&&`, `;`, pipes, absolute paths in the command string |
| Repo root via `working_directory` | Embed `cd` in the command |

Rules:

1. **One command per shell call** — run each pipeline step as a separate invocation.
2. **Repository root** — if the shell is not already at the project root, set `working_directory` to the repo root.
3. **Preflight is not in the loop** — run every `preflight[]` entry once at the start of this `/finalize`, before the first outer-loop pass; do not re-run preflight after loop-phase failures or when restarting the outer loop within the same `/finalize`.

### Inspection, debugging, and fixes (not pipeline commands)

To diagnose failures and apply fixes, use normal agent tooling: read files, search the codebase, edit files, run ad-hoc shell commands (`git diff`, targeted test runs, etc.).

**Pipeline invocations stay exact.** Inspection and editing are not restricted — only preflight and loop commands must match the form above.

## Exit codes

- **Any non-zero exit code is a failure** — lint, type, test, timeout, infrastructure, or signal interruption.
- **Do not treat warnings or textual “success” messages as success** when the process exits non-zero.
- **Missing or empty command output** with non-zero exit still counts as failure; investigate via logs, stderr, or re-run with verbose flags if the tool supports them.

## Output handling

- **Preserve complete command output for analysis** — read stderr/stdout fully when determining root cause.
- **Summarize in status messages** — do not dump entire test suites or huge logs to the user unless they ask.
- **Do not truncate diagnostic output** when it is needed to determine the root cause or choose a fix.

## Communication

{{#caveman}}
**Read and follow** the **caveman** skill for the entire finalize run (project-local in `.agents/skills/`).

- Default intensity: **full** (user can override with `/caveman lite|full|ultra`).
- Stay in caveman for status updates, failure analysis, and fix summaries.
- Code, diffs, and error output stay exact — caveman rules do not abbreviate those.
- Revert to normal mode only if user says "stop caveman" or "normal mode".

Example progress line: `fallow phase fail. dupes in fetch-trip-map-data.ts. Fix. Retry fallow command only.`
Example done line: `All green. Pipeline pass.`
{{/caveman}}

{{#brief}}
Keep status updates **short and direct**:

- One line per step: what ran, pass/fail, next action.
- Failure analysis: root cause + fix plan in plain language, no fluff.
- Code, diffs, and error output stay exact.
- Do not load or invoke the caveman skill.

Example progress line: `fallow phase failed (duplication in fetch-trip-map-data.ts). Fixing, then retry fallow command only.`
Example done line: `All configured checks pass.`
{{/brief}}

## What the Fallow phase gates

Postinstall adds `"check:fallow"` as the last `loop[]` entry. That step uses the **fallow inner loop**.

Fix policy (never suppress, never relax thresholds, fix priority): **`.cursor/rules/fallow.mdc`** (`alwaysApply` — also applies outside `/finalize`).

## Preflight

`pipeline.preflight[]` is an ordered list of package scripts that must pass before the main finalize loop starts.

For each entry in `preflight[]` (in order):

1. Run `{{packageManager}} run {script}`.
2. If it fails, capture and analyze the output.
3. Fix the root cause.
4. Re-run the failing preflight script.
5. Continue with the remaining preflight scripts only after the failing script passes.

If `preflight` is `[]`, skip preflight and start the outer loop immediately.

Preflight scripts are run once per `/finalize`. They are not part of the outer loop and are not re-run when the outer loop restarts after a loop-phase failure.

Postinstall determines which preflight scripts exist for the project. `/finalize` does not infer, detect, or add preflight commands itself.

## When to Use

**Only when the user invokes `/finalize`.** Do not run this skill proactively — not before commits, not before PRs, not when you think the repo needs a quality pass. Equivalent triggers (`finalize`, `/finalize`) count; paraphrases like "get it green" or "polish before PR" do **not** unless the user explicitly invokes `/finalize`.

## Loop behavior

### Preflight retry and escalation

Apply the **Preflight** rules above. Additionally:

- **Preflight retry cap: 3 attempts per failing preflight script** (including the first run). After 3 non-zero exits for the same script, escalate (see below).
- Preflight attempts count toward **no progress** — if the failing output is materially unchanged after a fix attempt, escalate immediately (do not wait for 3 attempts).

### Outer loop (full pipeline)

Run each `loop[]` entry in order. If all pass, the skill is **done**.

### On failure

| Failed step | After fix, re-run |
|--------------|-------------------|
| Any loop step **except** `"check:fallow"` | **Full outer loop** from the first `loop[]` entry |
| `"check:fallow"` only | **That step only** — fallow inner loop (see below) |

Do not proceed to the next step while the current one is failing.

### Fallow inner loop

**The fallow inner-loop step is `"check:fallow"` in `loop[]`.** Do not infer from other script names.

When **only** `check:fallow` fails (earlier loop steps green in this outer pass):

1. Capture and analyze the full Fallow output (summarize for the user; keep full detail for diagnosis).
2. Fix per **`.cursor/rules/fallow.mdc`** (minimal, targeted fixes).
3. Re-run **only** **`{{packageManager}} run check:fallow`** — do **not** re-run earlier loop steps yet.
4. Repeat until fallow exits 0 (subject to fallow retry cap and no-progress rules).
5. After Fallow first reaches exit code 0, **restart the outer loop from the first `loop[]` entry**. This restart is the **verification pass** — confirm earlier phases still pass together. If the verification pass fails, apply the normal outer-loop failure rules (not another fallow-only shortcut unless fallow alone fails again).

### On failure (non-fallow loop phases)

If a loop step other than `check:fallow` fails:

1. Capture and analyze the full error output (summarize for the user).
2. Fix the root cause (prefer minimal, targeted fixes).
3. **Restart from the first `loop[]` entry**.
4. Repeat until all loop commands pass in one consecutive outer run (with fallow inner loop as needed).

### Fix priority within a failing step

For `check:ci`-style steps that chain biome + tsc + tests, fix in this order:

1. **Biome / format** errors first.
2. **Type errors** (`tsc`) next.
3. **Test failures** last. **Do not edit tests while `tsc` still fails**.
4. **Fallow** findings only once CI is green — fix per **`.cursor/rules/fallow.mdc`**.

### When to stop and escalate

Do not loop forever. Stop and ask the user when:

1. **No progress** — applies only when the **same failure** remains **materially unchanged** across retries **without a meaningful improvement** in the failing condition, for **two consecutive iterations** of the same retry context (preflight retry, fallow inner loop, or outer loop). Examples:
   - Same error message and same failing file/line/test after a fix that should have addressed it.
   - Fallow: same reported findings (same files, same categories, same locations) after a targeted fix.
   - **Not** no progress: total finding count unchanged but category mix improved (e.g. dead-code findings resolved, duplication remains) — keep iterating on the remaining category.
   - **Not** no progress: outer loop hits different steps on successive passes (e.g. format fail → fix → CI fail → fix → format fail again) — the pipeline moved forward; evaluate no progress only within the **same** failing step and **same** error signature.
2. **Iteration cap** — 5 full outer-loop passes without all-green, **10 consecutive fallow-only retries**, or **3 attempts per failing preflight script**.
3. **Out-of-scope fix** — needs a design decision or destructive change.
4. **Ambiguous failure** — root cause unclear after analyzing preserved command output.

On escalation, report the failing step, exact error (or concise excerpt), and what was tried. Do not commit or keep retrying blindly.

## Success condition

Preflight (if any) must have completed successfully before the loop in this `/finalize`. Done when one **outer** pass completes with no fallow inner loop pending — every `loop[]` step exits 0.

If fallow needed fixes, the winning outer pass is the **verification** run after the fallow inner loop turned green.

## Agent rules

1. **Invoke gate** — run this skill only when the user invokes `/finalize`; never proactively.
2. **Load and validate pipeline first** — stop if missing or invalid; execute only what `pipeline.json` defines — do not infer, detect, or add preflight or loop commands.
3. {{#caveman}}**Communication** — load and follow caveman skill for the entire run.{{/caveman}}{{#brief}}**Communication** — short direct status updates; do not load caveman skill.{{/brief}}
4. **Run preflight once per /finalize** — for each script in `preflight[]` in order; max 3 attempts per failing preflight script; never re-run preflight when restarting the loop within the same `/finalize`.
5. **Run pipeline commands exactly** — `{{packageManager}} run {script}` for preflight and each loop entry; inspection/editing may use other tools.
6. **Non-zero exit = failure** — regardless of stdout wording.
7. **Restart rules** — non-fallow failure → restart from first loop entry. Fallow-only failure → loop `check:fallow` until green, then verification pass from first entry.
8. **Fallow inner loop** — only the `"check:fallow"` entry in `loop[]`.
9. **Do not skip loop entries** — run in pipeline order.
10. **Prefer minimal fixes** over large refactors unless clearly required.
11. **Keep iterating** until the full pipeline is green.
12. **Fix in priority order** — Biome → types → tests → Fallow (see `.cursor/rules/fallow.mdc`).
13. **Escalate, don't loop forever** — no progress, iteration caps, out-of-scope, ambiguous failure.
14. **Do not commit** unless the user explicitly asks.

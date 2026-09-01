---
name: finalize
description: >
  Continuous quality fix loop. Reads .cursor/finalize-pipeline.json (from finalize init).
  Runs the configured bootstrap once, then repeatedly executes all configured loop[] phases
  according to their loop semantics until the pipeline is green. Communication style follows
  pipeline.communication (caveman or brief). Use only when the user invokes /finalize.
---

# Finalize: continuous quality fix loop

Ensure the codebase passes all checks defined in **`.cursor/finalize-pipeline.json`**.

The skill is **complete only when every loop command in the pipeline passes consecutively with exit code 0**.

## Load and validate pipeline (start of every /finalize)

1. Read **`.cursor/finalize-pipeline.json`** at repo root.
2. If missing → stop. Tell the user to run `scripts/init.mjs` once (see [README](README.md)).
3. Parse JSON. If invalid → stop and report the parse error.
4. Validate before running anything:

| Check | On failure |
|-------|------------|
| `loop` exists and is a non-empty array | Stop — pipeline has no runnable steps |
| Each `loop[]` entry has `command` as a non-empty string | Stop — name the invalid index |
| `bootstrap.command`, if present, is a non-empty string | Stop — invalid bootstrap |
| `innerLoop`, if present on any entry, is boolean | Stop — invalid innerLoop type |
| The entry with `phase: "fallow"` must have `innerLoop: true` and `script: "check:fallow"` | Stop — invalid Fallow entry |
| No other entry may have `innerLoop: true` | Stop — innerLoop is allowed only on the Fallow entry |
| `communication`, if present, is `"caveman"` or `"brief"` | Stop — unknown communication value |

**Fallow invariant:** `phase: "fallow"` ↔ `innerLoop: true` (same entry; that entry must also have `script: "check:fallow"`).

5. If **`bootstrap.command`** is set → run it **once** before the loop (not inside the loop).
6. Run each **`loop[].command`** in order. Apply inner-loop semantics to the entry with `phase: "fallow"` and `innerLoop: true` (see below).

## Command execution (pipeline only)

These rules apply **only** to strings in `bootstrap.command` and `loop[].command`.

| Do | Don't |
|----|-------|
| Exact `command` from pipeline JSON | Rewrite into other tools or script names |
| One command per shell call | `cd`, `&&`, `;`, pipes, absolute paths in the command string |
| Repo root via `working_directory` | Embed `cd` in the command |

Rules:

1. **No prefixes or chaining** — no `cd`, `&&`, `;`, pipes, or absolute paths in pipeline command strings.
2. **No substitutions** — pipeline `command` strings only.
3. **One command per shell call** — run each pipeline step as a separate invocation.
4. **Repository root** — if the shell is not already at the project root, set `working_directory` to the repo root.
5. **Bootstrap is not in the loop** — run bootstrap once before the first outer-loop pass; never re-run after loop-phase failures or when restarting the outer loop.

### Inspection, debugging, and fixes (not pipeline commands)

To diagnose failures and apply fixes, use normal agent tooling: read files, search the codebase, edit files, run ad-hoc shell commands (`git diff`, targeted test runs, etc.).

**Pipeline commands stay exact.** Inspection and editing are not restricted to pipeline strings — only the configured bootstrap and loop commands must match the JSON literally.

## Exit codes

- **Any non-zero exit code is a failure** — lint, type, test, timeout, infrastructure, or signal interruption.
- **Do not treat warnings or textual “success” messages as success** when the process exits non-zero.
- **Missing or empty command output** with non-zero exit still counts as failure; investigate via logs, stderr, or re-run with verbose flags if the tool supports them.

## Output handling

- **Preserve complete command output for analysis** — read stderr/stdout fully when determining root cause.
- **Summarize in status messages** — do not dump entire test suites or huge logs to the user unless they ask.
- **Do not truncate diagnostic output** when it is needed to determine the root cause or choose a fix.

## Communication

Read **`pipeline.communication`** from `.cursor/finalize-pipeline.json`:

### `"caveman"`

**Read and follow** the **caveman** skill for the entire finalize run (globally installed or project-local).

- Default intensity: **full** (user can override with `/caveman lite|full|ultra`).
- Stay in caveman for status updates, failure analysis, and fix summaries.
- Code, diffs, and error output stay exact — caveman rules do not abbreviate those.
- Revert to normal mode only if user says "stop caveman" or "normal mode".

Example progress line: `fallow phase fail. dupes in fetch-trip-map-data.ts. Fix. Retry fallow command only.`
Example done line: `All green. Pipeline pass.`

### `"brief"` (or missing — treat as brief)

No caveman skill dependency. Keep status updates **short and direct**:

- One line per step: what ran, pass/fail, next action.
- Failure analysis: root cause + fix plan in plain language, no fluff.
- Code, diffs, and error output stay exact.
- Do not load or invoke the caveman skill.

Example progress line: `fallow phase failed (duplication in fetch-trip-map-data.ts). Fixing, then retry fallow command only.`
Example done line: `All configured checks pass.`

## What the Fallow phase gates

Init always configures the Fallow loop entry as (all three fields required together):

| Field | Value |
|-------|-------|
| `phase` | `"fallow"` |
| `script` | `"check:fallow"` |
| `innerLoop` | `true` |
| `command` | Package-manager run of `check:fallow` (e.g. `bun check:fallow`, `npm run check:fallow`) |

Run **that entry's `command` exactly** — the green criterion for Fallow is that pipeline string, not any other invocation.

The `check:fallow` script runs `fallow --quiet --format json && fallow --quiet --fail-on-issues`. Project config in `.fallowrc.json` may set `duplicates.threshold` (e.g. `0.001`). Combined mode fails on:

| Category | Trigger | Fix approach |
|----------|---------|--------------|
| Dead code | `--fail-on-issues` + unused files/exports/deps | Remove dead code, or trace with `fallow dead-code --trace-file` / `--trace-dependency` before deleting |
| Duplication | `duplicates.threshold` exceeded | Extract shared helper/module; dedupe clone groups Fallow reports |
| Complexity | Health findings above thresholds | Extract helpers, split components — see project Fallow rules if present (e.g. `.cursor/rules/fallow.mdc`) |

Never use `// fallow-ignore-next-line complexity` or relax Fallow thresholds to pass.

## When to Use

**Only when the user invokes `/finalize`.** Do not run this skill proactively — not before commits, not before PRs, not when you think the repo needs a quality pass. Equivalent triggers (`finalize`, `/finalize`) count; paraphrases like "get it green" or "polish before PR" do **not** unless the user explicitly invokes `/finalize`.

## Loop behavior

### Bootstrap (once, before the loop)

If `pipeline.bootstrap` is set:

1. Run **`bootstrap.command`**.
2. If it fails, capture output, fix the root cause, and re-run.
3. **Bootstrap retry cap: 3 attempts** (including the first run). After 3 non-zero exits, escalate (see below).
4. Bootstrap attempts also count toward **no progress** — if the failing output is materially unchanged after a fix attempt, escalate immediately (do not wait for 3 attempts).
5. Enter the outer loop only after bootstrap exits 0. **Do not run bootstrap again** — not after loop-phase fixes, not when restarting the outer loop, not after the fallow inner loop.

If no bootstrap, start the outer loop immediately.

### Outer loop (full pipeline)

Run each `loop[]` entry in order. If all pass, the skill is **done**.

### On failure

| Failed phase | After fix, re-run |
|--------------|-------------------|
| Any phase **without** `innerLoop: true` | **Full outer loop** from the first `loop[]` entry |
| Phase with `innerLoop: true` (Fallow only) | **That command only** — fallow inner loop (see below) |

Do not proceed to the next step while the current one is failing.

### Fallow inner loop

**The Fallow inner-loop entry is the one with `phase: "fallow"`, `script: "check:fallow"`, and `innerLoop: true`.** Validation rejects any other combination. Do not infer phase semantics from the command string.

When **only** that entry's command fails (earlier loop phases green in this outer pass):

1. Capture and analyze the full Fallow output (summarize for the user; keep full detail for diagnosis).
2. Fix the root cause (prefer minimal, targeted fixes). **Never** use fallow suppressions or relax thresholds.
3. Re-run **only** the fallow `command` — do **not** re-run earlier loop phases yet.
4. Repeat until fallow exits 0 (subject to fallow retry cap and no-progress rules).
5. After Fallow first reaches exit code 0, **restart the outer loop from the first `loop[]` entry**. This restart is the **verification pass** — confirm earlier phases still pass together. If the verification pass fails, apply the normal outer-loop failure rules (not another fallow-only shortcut unless fallow alone fails again).

### Fix priority within Fallow

When multiple Fallow categories fail at once, fix in this order:

1. **Dead code** — remove or wire up unused exports/files/deps first.
2. **Duplication** — extract shared functions/modules for reported clone groups.
3. **Complexity** — refactor functions above thresholds.

### On failure (non-fallow loop phases)

If a loop command without `innerLoop: true` fails:

1. Capture and analyze the full error output (summarize for the user).
2. Fix the root cause (prefer minimal, targeted fixes).
3. **Restart from the first `loop[]` entry**.
4. Repeat until all loop commands pass in one consecutive outer run (with fallow inner loop as needed).

### Fix priority within a failing step

For `check:ci`-style steps that chain biome + tsc + tests, fix in this order:

1. **Biome / format** errors first.
2. **Type errors** (`tsc`) next.
3. **Test failures** last. **Do not edit tests while `tsc` still fails**.
4. **Fallow** findings only once CI is green. Within Fallow: dead code → duplication → complexity.

### When to stop and escalate

Do not loop forever. Stop and ask the user when:

1. **No progress** — applies only when the **same failure** remains **materially unchanged** across retries **without a meaningful improvement** in the failing condition, for **two consecutive iterations** of the same retry context (bootstrap retry, fallow inner loop, or outer loop). Examples:
   - Same error message and same failing file/line/test after a fix that should have addressed it.
   - Fallow: same reported findings (same files, same categories, same locations) after a targeted fix.
   - **Not** no progress: total finding count unchanged but category mix improved (e.g. dead-code findings resolved, duplication remains) — keep iterating on the remaining category.
   - **Not** no progress: outer loop hits different phases on successive passes (e.g. format fail → fix → CI fail → fix → format fail again) — the pipeline moved forward; evaluate no progress only within the **same** failing phase and **same** error signature.
2. **Iteration cap** — 5 full outer-loop passes without all-green, **10 consecutive fallow-only retries**, or **3 bootstrap attempts**.
3. **Out-of-scope fix** — needs a design decision or destructive change.
4. **Ambiguous failure** — root cause unclear after analyzing preserved command output.

On escalation, report the failing phase, exact error (or concise excerpt), and what was tried. Do not commit or keep retrying blindly.

## Success condition

Bootstrap (if configured) must have completed successfully once before the loop. Done when one **outer** pass completes with no fallow inner loop pending — every `loop[]` command exits 0.

If fallow needed fixes, the winning outer pass is the **verification** run after the fallow inner loop turned green.

## Agent rules

1. **Invoke gate** — run this skill only when the user invokes `/finalize`; never proactively.
2. **Load and validate pipeline first** — stop if missing or invalid.
3. **Follow pipeline communication** — `"caveman"`: load caveman skill; `"brief"` or missing: short status updates, no caveman.
4. **Run bootstrap once** — only if `pipeline.bootstrap` is set; max 3 attempts; never re-run inside the loop.
5. **Run pipeline commands exactly** — bootstrap and loop `command` strings only; inspection/editing may use other tools.
6. **Non-zero exit = failure** — regardless of stdout wording.
7. **Restart rules** — non-fallow failure → restart from first loop entry. Fallow-only failure → loop fallow command until green, then verification pass from first entry.
8. **Fallow inner loop** — only the entry with `phase: "fallow"`, `script: "check:fallow"`, and `innerLoop: true`; do not infer from the command string.
9. **Do not skip loop entries** — run in pipeline order.
10. **Prefer minimal fixes** over large refactors unless clearly required.
11. **Keep iterating** until the full pipeline is green.
12. **Fix in priority order** — Biome → types → tests → Fallow (dead code → duplication → complexity).
13. **Escalate, don't loop forever** — no progress, iteration caps, out-of-scope, ambiguous failure.
14. **Do not commit** unless the user explicitly asks.

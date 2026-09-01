---
name: changelog
description: >
  Update CHANGELOG.md and package.json version from user-facing work since the
  previous release. Accepts /changelog X.Y.Z only (no prerelease); errors if live
  package.json is already higher; merges into an existing section on re-runs.
  Resolves a git baseline commit; includes commits plus staged, unstaged, and
  qualifying untracked files; deduplicates outcomes. Never commits. Use when the
  user says /changelog, passes a version, or asks for release notes.
---

# Changelog

Update root `CHANGELOG.md` (web app changelog UI). When a version is given, also set root `package.json` `"version"`.

Audience: **end users**. Skip refactors, tests, types, dead code, internal plumbing unless UI/behavior changes.

## Hard rules

1. **Never commit.** Edit files only.
2. **Never invent features** — every bullet maps to real visible behavior.
3. Cover the **full delta since the previous version**, not only the current chat or one feature slice.
4. Always include **commits** since the git baseline, plus **staged**, **unstaged**, and qualifying **untracked** files.
5. **Re-runs are merge, not rewrite** — read existing `CHANGELOG.md` first; keep good bullets; only add missing ones or revise bullets whose behavior changed.
6. **Deduplicate** identical user-facing outcomes across commits, staged, unstaged, and untracked — one bullet per outcome.
7. **Ignore any `package.json` version-only change to the target** when deriving user-facing outcomes, **regardless of whether it predates this run** (not only bumps this skill just wrote).

## Version argument

Accept **only** `X.Y.Z` (digits and dots). **Prerelease and build metadata are invalid** (`1.2.3-beta`, `1.2.3+build` → error, no edits).

| Invocation | Behavior |
|------------|----------|
| `/changelog 0.3.5` | Target = that version. Set `package.json` `"version"` to it. Notes under `## 0.3.5`. |
| `/changelog` (no version) | Target = current `package.json` if filling that section; otherwise ask for `X.Y.Z`. |

### Live version guard

Read live version from root `package.json` `"version"` (must also be plain `X.Y.Z`).

Compare **semver** major.minor.patch only:

- **live > target** → **error**, no edits. Report live and rejected target.
- **live == target** → OK (re-run). Update changelog; `package.json` already correct.
- **live < target** → OK. Bump `package.json` to target, then update changelog.

## Baseline version (changelog)

Previous version = newest `## X.Y.Z` in `CHANGELOG.md` that is **strictly older** than the target (semver). If the target section already exists, baseline is still the section **below** it — not “since last chat.”

**No older section exists** (first release / empty history of versions):

- **Default:** use the **entire reachable git history** plus the current worktree as the source set.
- **Exception:** if that scope is clearly ambiguous or excessively large → **error** and ask for a commit/ref. Do not invent a fake previous version.

Do not backfill older sections.

## Baseline commit (git)

Translate the baseline **version** into a **git ref** before gathering commits/diffs:

1. Prefer the **earliest reachable commit** that introduced or first contained the previous release version — e.g. where root `package.json` `"version"` became (or already was) that baseline version (`git log -S` / blame), if traceable.
2. Else use the commit that **added or last materially edited** that baseline’s `##` section in `CHANGELOG.md`.
3. If neither is traceable and an older changelog section exists → **error**: report that the baseline version could not be mapped to a commit; ask for a ref.
4. If there is **no** older version → apply the first-release default above (full reachable history; error only if ambiguous/excessively large). Do not guess a random commit.

### Committed delta

When a baseline commit exists:

1. Enumerate commits with `git log <baseline-commit>..HEAD` (origin / what landed).
2. Inspect user-facing changes via those commits’ diffs when needed for context.
3. Use `git diff <baseline-commit>..HEAD` as the **aggregate committed tree delta** — the primary signal for what is user-facing **now**. Prefer this over treating a feature that was added then removed mid-range as a current outcome.

When there is no baseline commit (first release default): same idea over full reachable history (`git log` for origin, aggregate diff / current tree for what remains).

Then add current worktree: staged, unstaged, qualifying untracked.

## Worktree sources

| Source | Include |
|--------|---------|
| Staged | `git diff --cached` |
| Unstaged | `git diff` |
| Untracked | Only files that are part of the **current worktree** and clearly **introduce or change user-facing behavior** (UI copy, user-visible flows). Ignore tooling junk, local secrets, generated noise, and unrelated untracked paths. |

**Deduplicate** the same user-facing outcome if it appears in more than one of: commit range, staged, unstaged, untracked.

**Ignore** any `package.json` version-only change to the target when deriving outcomes, whether from this run or already present in the worktree.

## Idempotent merge (multiple runs)

1. **Read** full current `CHANGELOG.md` (especially the target `##` section if present).
2. Discover outcomes from all sources; dedupe.
3. **Merge** into the target section:
   - **Keep** existing bullets that still match current behavior.
   - **Add** bullets for outcomes not yet represented.
   - **Update** a bullet only when the same feature’s user-facing behavior changed (rewrite that line; do not duplicate).
   - **Do not** delete bullets unless the feature was removed or the bullet is wrong.
4. Leave all older `##` sections unchanged.
5. Do not reshuffle or rephrase the whole section “for style” on every run.

Same feature = same place + control/noun, not exact string equality.

## Dates

- **New** target section → heading date = **today** (not the previous release’s date).
- **Re-run** on an existing target section → **keep** the existing heading date unless the user asks to change it.

## Workflow

1. Parse target: require `X.Y.Z` or ask. Reject prerelease/build.
2. Live version guard. On failure, stop.
3. Read `CHANGELOG.md`.
4. Resolve baseline **version**, then baseline **commit** (or first-release full history / error).
5. **Gather all sources before applying the version bump** — commit log + aggregate committed diff, staged, unstaged, qualifying untracked; dedupe. Causal order: analyze first, then write `package.json`, so this run’s bump never enters the analyzed unstaged diff. Ignore any version-only `package.json` change to the target when deriving outcomes, even if it already existed before this run.
6. Set `package.json` `"version"` to target when a version was given / live < target.
7. Merge bullets into `## <target> — <date>` (create vs keep date per Dates).
8. Emit the **output contract** below. Stop. Never commit.

## Output contract

After every successful run, report exactly:

```text
target: <X.Y.Z>
package.json: changed | unchanged
bullets added:
- ...
bullets updated:
- ...
(no commit)
```

If none added/updated, write `bullets added: (none)` / `bullets updated: (none)`.

On guard/baseline/version-format failure, report the error only — no file edits, no fake success block.

## Entry tone

Short. Punchy. Caveman-tight. English. One outcome per bullet.

```markdown
## 0.6.3 — 2026-08-26

- Location map region: **Export points** → JSON (`lat`, `lon`, `precision`)
- Map features: **Ctrl+click** adds to selection; panel shows count
```

- Place first, then **bold** the control/noun users see.
- No filler, paths, PR numbers, implementation detail.

## Checklist

- [ ] Target is plain `X.Y.Z`
- [ ] Live ≤ target (else error, no edits)
- [ ] Baseline version resolved; baseline commit resolved (or first-release full history / explicit error)
- [ ] Sources gathered **before** `package.json` bump
- [ ] `git log` for commit origin; aggregate `git diff` for current committed delta
- [ ] Staged + unstaged + qualifying untracked; outcomes deduped
- [ ] Any version-only `package.json` change to target ignored as an outcome (this run or pre-existing)
- [ ] Existing target section merged, not blindly rewritten
- [ ] New section date = today; re-run keeps date
- [ ] Output contract printed
- [ ] No commit

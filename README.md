# cursor-skills

Personal Cursor agent skills, installable via the [skills CLI](https://github.com/vercel-labs/skills).

## Install

```bash
npx skills add MarByteBeep/cursor-skills --list

npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor -g --copy -y
npx skills add MarByteBeep/cursor-skills --skill changelog -a cursor -g --copy -y
```

Use `--copy` if Cursor does not pick up symlinked skills.

## Skills

| Skill | Description |
|-------|-------------|
| `finalize` | Quality loop from `.cursor/finalize-pipeline.json` (see [skills/finalize/README.md](skills/finalize/README.md)) |
| `changelog` | Update `CHANGELOG.md` and `package.json` version from user-facing changes |

`finalize` expects **caveman** installed separately (`npx skills add JuliusBrussee/caveman -a cursor -g`).

Setup, init, bun vs node, and pipeline fields: **[skills/finalize/README.md](skills/finalize/README.md)**.

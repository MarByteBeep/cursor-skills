# cursor-skills

Cursor agent skills, installable via the [skills CLI](https://github.com/vercel-labs/skills).

## Install

```bash
# List available skills
npx skills add MarByteBeep/cursor-skills --list

# Project scope
npx skills add MarByteBeep/cursor-skills --skill finalize -a cursor
npx skills add MarByteBeep/cursor-skills --skill changelog -a cursor

# Global (all projects)
# Don't install finalise skill globally, as it depends on the repo
npx skills add MarByteBeep/cursor-skills --skill changelog -a cursor -g

# Both at once
npx skills add MarByteBeep/cursor-skills --skill finalize --skill changelog -a cursor -g
```

Use `--copy` if Cursor does not pick up symlinked skills.

## Skills

| Skill | Description |
|-------|-------------|
| `finalize` | Quality loop: Supabase types → format → CI → Fallow until green (uses caveman mode) |
| `changelog` | Update `CHANGELOG.md` and `package.json` version from user-facing changes |

`finalize` expects the **caveman** skill to be installed separately (globally or in the project).

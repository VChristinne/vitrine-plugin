# Vitrine

An objects hub for Obsidian, in the spirit of Capacities: your notes become typed
objects — pages, tasks, books, games, weblinks — driven by frontmatter rather than
folder structure.

> **Public beta.** It works, and it's what I use daily, but it's pre-1.0: the
> settings shape still moves between releases, and Vitrine writes frontmatter to
> your notes (creating objects, editing properties, advancing tasks). Try it on a
> copy of your vault first, or make sure you have a backup.

## Installation (BRAT)

Vitrine isn't in the community plugin store; install the beta through
[BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from Settings → Community plugins.
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Paste `VChristinne/vitrine-plugin` and confirm (leave the version on latest).
4. Enable **Vitrine** under Settings → Community plugins.

BRAT auto-updates it whenever a new release is published.

## How it works

Open the hub with the ribbon icon or **Open Vitrine objects**. The sidebar lists your
**object types**; each type is seeded from a template note and is editable from the
hub — icon, colour, property schema, collections and templates. A template is a note
carrying both `status: template` and the `object:` of the type it templates — the two
together, so a vault that already uses `status: template` for its own purposes keeps
those notes as ordinary objects.

A note joins a type through its `object:` property, and a collection through
`collection:`. Everything else is just the properties the type declares:

```yaml
---
object: __book
collection: My Reason to Die
title: My Reason to Die, Vol. 5
author: YUJU
rating: 5
status: read
---
```

Inside a type you get **Overview** and **All**, plus any **saved queries** you add as
extra tabs (rule-based views over the type's objects). Tasks are a built-in type with
their own quick-add parser, recurrence, status/priority lanes and notifications, and
there's a calendar over anything carrying a date.

The **New** button creates a blank object; its caret opens the templates menu — one
entry per collection and per template the type carries, plus "New template…".

Games linked to Steam show a synced achievements panel on their object page
(**Sync achievements (all games)**).

## Development

```bash
npm install
npm run dev     # esbuild in watch mode
npm run build   # type-check and bundle
npm test        # node:test suites under tests/
```

Point `VITRINE_VAULT` at a vault's plugin folder and every build drops `main.js`,
`manifest.json` and `styles.css` there, so a rebuild is ready to reload:

```bash
export VITRINE_VAULT=~/Vault/.obsidian/plugins/vitrine
```

CSS is modular: sources in `styles/*.css`, concatenation order in
`styles/_manifest.js`. The top-level `styles.css` is **generated** — never edit it.

In Obsidian: Settings → Community plugins → enable **Vitrine**. After each
change, disable and re-enable the plugin (or use pjeby's Hot Reload).

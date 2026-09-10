# Language

A system language selector for [Omarchy](https://omarchy.org) Quattro — the
one setting the installer never asks about.

Omarchy is English-only by design: the installer picks a keyboard layout and
nothing else, so `LANG` stays `en_US.UTF-8` until someone edits
`/etc/locale.gen` by hand and runs `locale-gen`. This plugin puts that on the
bar: a searchable list of every UTF-8 locale glibc ships, and a second list
for regional formats when you want, say, a Slovenian keyboard, an English
desktop, and metric dates.

```bash
omarchy plugin add https://github.com/sbelcl/omarchy-language.git --enable
```

Or, to set the language, translate the menu and install the Slovenian clock
in one go — the path to hand someone who just wants a Slovenian desktop:

```bash
curl -fsSL https://raw.githubusercontent.com/sbelcl/omarchy-language/master/setup | bash -s -- --with-clock
```

`setup` takes a locale (`bash -s -- de_DE.UTF-8`), is safe to re-run, and is
the way to refresh the menu translation after an Omarchy update.

## What it does

- **Display language** — sets `LANG`. Picking a language nobody has generated
  yet generates it on the way through; that takes a few seconds.
- **Formats** — sets `LC_TIME`, `LC_NUMERIC`, `LC_MONETARY`, `LC_PAPER` and
  `LC_MEASUREMENT` independently of the language, or leaves them following it.
- **A Language row in the menu** — under Posodobi/Update, beside Timezone,
  opening the same picker Omarchy's own settings use. This is where a language
  selector belongs; the bar widget exists because a plugin cannot add rows to
  the packaged menu, not because a bar is the right home for a settings action.
- **Omarchy menu** — translates the menu itself, where a table exists for the
  language. Off by default. See below for what this can and cannot reach.
- **Bar label** — the language code (`EN`, `SL`) or a globe glyph; the tooltip
  spells the locale out.

Click the widget, or bind the panel to a key:

```bash
omarchy-shell imnos.language toggle
```

## How it works

Everything privileged is one `localectl set-locale` call. `systemd-localed`
on Arch is built with `locale-gen` support, so that single call uncomments the
locale in `/etc/locale.gen`, runs `locale-gen`, and writes `/etc/locale.conf`.
Authentication is the ordinary polkit prompt for
`org.freedesktop.locale1.set-locale`, answered by Omarchy's own agent — no
`sudo`, and nothing in this plugin ever runs as root.

The locale list is glibc's own `/usr/share/i18n/SUPPORTED`, with English
language and territory names read out of each locale's `LC_IDENTIFICATION`
block, so the list tracks whatever glibc ships rather than a hand-kept table.
Locale names are passed through exactly as `SUPPORTED` spells them: roughly
half carry a codeset (`en_US.UTF-8`) and half do not (`aa_ER`,
`be_BY@latin`), and that spelling is both what systemd matches before it
agrees to generate a locale and the name `locale-gen` hands to `localedef`.
Rewriting one form into the other breaks it.

## Translating the menu

The Omarchy menu is the only part of the shell that is data rather than code:
its rows live in JSONC and `~/.config/omarchy/extensions/omarchy-menu.jsonc`
overrides them by id. Switch the toggle on and all ~320 rows are rewritten in
the system language. The shell watches that file, so the menu changes as the
switch flips — no restart, no log out.

Two things make this less simple than it looks.

**Overrides have to re-declare the whole row.** The shell's own comment
promises a per-key merge, but `parseMenuJsonc` normalizes every entry to a
full object with empty-string defaults before merging, so
`{"label": "Omrežje"}` lands as a row with no icon and no action behind it.
Rows are therefore copied wholesale from the defaults with only `label` and
`title` swapped. That is why the generated block records a hash of the file it
copied from, and why the panel reports the translation **out of date** once
Omarchy's own menu moves under it. Refresh re-copies from the new defaults.

**The English word stays searchable.** Menu search scores a description match,
so each translated row carries its English label in `description` — typing
`network` still finds *Omrežje*. Rows that already had a description keep it.

Your own rows and comments in the extension file are left alone: everything
outside the generated block is preserved verbatim, the previous file is kept
as `.bak`, and nothing is written until the result has been parsed back the
same way the shell parses it. A file that fails to parse is dropped whole by
the shell, taking your rows with it, so the generator refuses rather than
risk that.

### Adding a language

Drop a `translations/<locale>.tsv` next to the others — `English<TAB>your
language`, one per line, `#` for comments. Keys are the English strings, not
row ids, so a word translates once wherever it appears and a row Omarchy adds
later using a word already in the table translates itself. Anything absent
stays English, which is the right answer for Steam, Docker and Tailscale.

## Limits

- **`LANG` is read at login.** Nothing can retrofit it onto the session you
  are in, so the panel offers a log-out row once a change lands.
- **The bar and the panels stay English.** Their strings are literals inside
  each plugin's QML and there is no hook for one plugin to reach another's
  ([omarchy#7284](https://github.com/omacom/omarchy/issues/7284) asks for the
  translation layer that would change this). The menu is reachable because it
  is data; nothing else is.
- **The clock is English for a different reason.** `Qt.formatDateTime(date,
  format)` ignores the locale — it renders `Tuesday` in a process whose
  `Qt.locale()` is `sl_SI`. `date.toLocaleString(Qt.locale(), format)` takes
  the same format string and renders `torek`. That is a one-line change, but
  it lives inside the clock's own QML, so it ships as a separate plugin:
  [omarchy-clock-sl](https://github.com/sbelcl/omarchy-clock-sl), installed by
  `setup --with-clock`.
- **Non-UTF-8 locales are not offered.** systemd will not auto-generate them,
  and you do not want one.
- **Your home folders keep the names they were created with.** `~/Documents`,
  `~/Downloads` and the rest come from `xdg-user-dirs` at first login, in
  whatever language was current then, and nothing renames them afterwards. A
  machine installed in Slovenian gets *Dokumenti* and *Prenosi* from the
  start; one switched later keeps the English names.

  `setup` deliberately leaves this alone. Renaming them moves real
  directories, and anything holding a path — scripts, an application's
  bookmarks, your own habits — breaks quietly. If you want it anyway, and you
  know nothing points at those paths:

  ```bash
  xdg-user-dirs-update --force
  ```

- This is the system language. Keyboard layout is a separate axis, set from
  `/etc/vconsole.conf` and shown by the built-in `omarchy.keyboard-layout`
  widget.

## Settings

| Key       | Values           | Default | Effect                              |
|-----------|------------------|---------|-------------------------------------|
| `display` | `Code` / `Icon`  | `Code`  | Language code or globe on the bar   |

Set from Setup → Plugins, or inline on the widget's `shell.json` entry:

```json
{ "id": "imnos.language", "display": "Icon" }
```

## The string catalog

`locales/sl.json` is a plain map of English string to translation, installed to
`~/.config/omarchy/locales/<lang>.json` by `catalog install` (and by `setup`).
The translated panel plugins read it at runtime rather than carrying Slovenian
inside their QML, so one file covers every panel and a translator adds `ru.json`
without touching anyone's code.

It is installed only when absent — once it is in your config it is yours to
edit, and a plugin update quietly reverting your wording would be a miserable
bug to find. `catalog refresh` overwrites deliberately, keeping a `.bak`.

Catalogs are named for the **language**, not the country: Slovenian is `sl`.
`si` is Sinhala (`si_LK`) — the keyboard layout being called `si` is ISO 3166
naming Slovenia the country, a different standard answering a different
question. A `si.json` would never load, and would collide with Sinhala the day
someone writes one.

## The rest of the desktop

Two companion pieces, because a plugin cannot reach into another plugin's QML:

- [omarchy-clock-sl](https://github.com/sbelcl/omarchy-clock-sl) — the clock
  with Slovenian day and month names. It declares `clonedFrom`, so it takes the
  built-in clock's place in the bar and gives it back when removed.
- [omacom/omarchy#7284](https://github.com/omacom/omarchy/issues/7284) — a
  translation layer for the shell's own strings, so the panels and dialogs
  stop needing a fork per panel. Prototype:
  [sbelcl/omarchy@i18n-prototype](https://github.com/sbelcl/omarchy/tree/i18n-prototype).

## Development

```bash
omarchy plugin validate .   # manifest against the schema the shell enforces
./test/model-test.sh        # Model.js, locales.awk, menu-translate; needs node
./menu-translate status     # what the panel's menu section is reading
```

The menu test is the one that matters: it runs the generator against the real
Omarchy menu, merges the result through the shell's own `MenuModel.js`, and
fails if any row loses its icon, action, aliases, `when` or `checked` — the
exact damage a label-only override causes.

`Model.js` is deliberately Qt-free so the parsing, matching and argument
building are testable under node; `Panel.qml` holds only the wiring and the
UI.

Saving a file under `~/.config/omarchy/plugins/` hot-reloads the plugin, but
a widget already placed on the bar can keep its existing instance through the
reload — the shell logs `Local plugin changed, reloading` and nothing visibly
changes. `omarchy-restart-shell` is the one way to be sure you are looking at
the code you just wrote.

## License

MIT

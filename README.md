# Language

A system language selector for [Omarchy](https://omarchy.org) Quattro — the
one setting the installer never asks about.

Omarchy is English-only by design: the installer picks a keyboard layout and
nothing else, so `LANG` stays `en_US.UTF-8` until someone edits
`/etc/locale.gen` by hand and runs `locale-gen`. This plugin puts that on the
bar: a searchable list of every UTF-8 locale glibc ships, and a second list
for regional formats when you want, say, a Slovenian keyboard, an English
desktop, and metric dates.

```
omarchy plugin add https://github.com/<you>/language.git --enable
```

## What it does

- **Display language** — sets `LANG`. Picking a language nobody has generated
  yet generates it on the way through; that takes a few seconds.
- **Formats** — sets `LC_TIME`, `LC_NUMERIC`, `LC_MONETARY`, `LC_PAPER` and
  `LC_MEASUREMENT` independently of the language, or leaves them following it.
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

## Limits

- **`LANG` is read at login.** Nothing can retrofit it onto the session you
  are in, so the panel offers a log-out row once a change lands.
- **Omarchy's own UI stays English.** Its shell strings are hardcoded in QML
  with no translation layer ([omarchy#7284](https://github.com/omacom/omarchy/issues/7284)).
  This changes the system locale, which is what GTK/Qt apps, browsers and
  `xdg-user-dirs` follow — not Omarchy's menus.
- **Non-UTF-8 locales are not offered.** systemd will not auto-generate them,
  and you do not want one.
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

## Development

```bash
omarchy plugin validate .   # manifest against the schema the shell enforces
./test/model-test.sh        # Model.js + locales.awk, needs node
```

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

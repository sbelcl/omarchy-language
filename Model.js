// Pure helpers for the Language widget. No Qt types in here, so the same
// file runs under node in test/model-test.sh.

// Locale variables a "Formats" choice owns. LANG stays separate: it is the
// language, and these are the conventions for dates, numbers, currency,
// paper size and units. Anything not listed is left for the user to set by
// hand -- localectl replaces the whole set on every call, so a variable this
// list forgets is a variable the widget would silently drop.
var FORMAT_VARS = ["LC_TIME", "LC_NUMERIC", "LC_MONETARY", "LC_PAPER", "LC_MEASUREMENT"]

// The value the Formats dropdown carries while it is following the language.
var FOLLOW_LANGUAGE = ""

// Everything a locale choice here can move, LANG first.
function localeVarNames() {
  return ["LANG"].concat(FORMAT_VARS)
}

// Rows out of locales.awk: "name\tlanguage\tterritory" per line.
function parseLocales(text) {
  var rows = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split("\t")
    if (parts.length < 2) continue
    var name = parts[0].trim()
    var language = parts[1].trim()
    if (name === "" || language === "") continue
    rows.push({ name: name, language: language, territory: (parts[2] || "").trim() })
  }
  return rows
}

// `localectl status` prints the locale variables on the "System Locale:"
// line and continuation lines under it. Reading every KEY=VALUE pair in the
// output instead of tracking that indentation is both shorter and immune to
// the layout changing; no other line localectl prints carries an "=".
function parseSystemLocale(text) {
  var vars = {}
  var re = /\b(LANG|LC_[A-Z_]+)=(\S+)/g
  var match
  while ((match = re.exec(String(text || ""))) !== null) vars[match[1]] = match[2]
  return vars
}

// Locale names that mean the same locale are not spelled the same way:
// /etc/locale.conf may say sl_SI.utf8 where SUPPORTED says sl_SI.UTF-8, and
// a bare name (aa_ER) means the UTF-8 locale in a table where UTF-8 is all
// we offer. Collapse the codeset for comparison only -- never for a name on
// its way to localectl, which insists on SUPPORTED's own spelling.
function localeKey(name) {
  var value = String(name || "").trim()
  if (value === "") return ""
  var modifier = ""
  var at = value.indexOf("@")
  if (at !== -1) {
    modifier = value.substring(at)
    value = value.substring(0, at)
  }
  var dot = value.indexOf(".")
  if (dot !== -1) value = value.substring(0, dot)
  return (value + modifier).toLowerCase()
}

function sameLocale(a, b) {
  var left = localeKey(a)
  return left !== "" && left === localeKey(b)
}

function findRow(rows, name) {
  var key = localeKey(name)
  if (key === "") return null
  for (var i = 0; i < (rows || []).length; i++) {
    if (localeKey(rows[i].name) === key) return rows[i]
  }
  return null
}

// The name to hand a dropdown for a locale the system is already using, or
// "" when it is one we have no row for (C.UTF-8, or a locale generated from
// something other than SUPPORTED). The dropdown shows nothing selected
// rather than guessing at a near match.
function rowValue(rows, name) {
  var row = findRow(rows, name)
  return row ? row.name : ""
}

// "Belarusian (Belarus)", or "Belarusian (Belarus, latin)" where a modifier
// is the only thing separating two otherwise identically named locales.
function rowLabel(row) {
  if (!row) return ""
  var at = String(row.name).indexOf("@")
  var modifier = at === -1 ? "" : String(row.name).substring(at + 1)
  var qualifiers = []
  if (row.territory) qualifiers.push(row.territory)
  if (modifier) qualifiers.push(modifier)
  if (qualifiers.length === 0) return row.language
  return row.language + " (" + qualifiers.join(", ") + ")"
}

// What to call the locale in force. Falls back to the raw name so a system
// sitting on something outside the table still reads as something.
function describe(rows, name) {
  if (String(name || "").trim() === "") return "Not set"
  var row = findRow(rows, name)
  return row ? rowLabel(row) : String(name)
}

// Bar label: the language half of the locale, upper-cased. sl_SI -> SL.
function shortCode(name) {
  var value = String(name || "").trim()
  if (value === "") return "--"
  var cut = value.search(/[._@]/)
  if (cut !== -1) value = value.substring(0, cut)
  return value.toUpperCase()
}

function options(rows) {
  var out = []
  for (var i = 0; i < (rows || []).length; i++) {
    out.push({ value: rows[i].name, label: rowLabel(rows[i]), description: rows[i].name })
  }
  out.sort(function (a, b) { return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0) })
  return out
}

function formatOptions(rows) {
  return [{ value: FOLLOW_LANGUAGE, label: "Same as language", description: "" }].concat(options(rows))
}

// What the Formats dropdown should show. LC_TIME is the representative of
// the group: unset, or set to the language's own locale, both mean the
// formats are simply following the language.
function formatsValue(rows, lang, lcTime) {
  if (String(lcTime || "").trim() === "") return FOLLOW_LANGUAGE
  if (sameLocale(lcTime, lang)) return FOLLOW_LANGUAGE
  return rowValue(rows, lcTime)
}

// localectl set-locale replaces every variable it is not given, which is
// what makes "Same as language" work: leave the LC_* out and they are gone.
function setLocaleArgs(lang, formats) {
  var args = ["set-locale", "LANG=" + lang]
  if (String(formats || "").trim() !== "" && !sameLocale(formats, lang)) {
    for (var i = 0; i < FORMAT_VARS.length; i++) args.push(FORMAT_VARS[i] + "=" + formats)
  }
  return args
}

// A session reads its locale once, at login. Anything that has changed since
// is pending a log out -- whether this panel changed it, another session did,
// or someone edited /etc/locale.conf by hand. Comparing the two is what makes
// the reminder honest: state that only remembered our own changes would go
// quiet across a shell restart while the session was still stale.
//
// An unset LC_* follows LANG, so it is compared against LANG rather than
// against nothing; a variable missing on both sides agrees by definition.
function sessionIsStale(systemVars, sessionVars) {
  var names = localeVarNames()
  for (var i = 0; i < names.length; i++) {
    var wanted = String((systemVars || {})[names[i]] || "") || String((systemVars || {}).LANG || "")
    var have = String((sessionVars || {})[names[i]] || "") || String((sessionVars || {}).LANG || "")
    if (wanted === "" || have === "") continue
    if (!sameLocale(wanted, have)) return true
  }
  return false
}

// "" when the session is current. Naming the language the session is still
// running beats a bare "log out": it says what the log out is worth.
function staleMessage(rows, systemVars, sessionVars) {
  if (!sessionIsStale(systemVars, sessionVars)) return ""
  var systemLang = String((systemVars || {}).LANG || "")
  var sessionLang = String((sessionVars || {}).LANG || "")
  if (!sameLocale(systemLang, sessionLang))
    return "Session is still " + describe(rows, sessionLang) + ". Log out and back in to switch."
  return "Log out and back in to apply the new formats."
}

// `menu-translate status` prints one line of key=value pairs.
function parseMenuStatus(text) {
  var out = { state: "off", locale: "", rows: 0, available: [] }
  var line = String(text || "").trim()
  var pairs = line.split(/\s+/)
  for (var i = 0; i < pairs.length; i++) {
    var cut = pairs[i].indexOf("=")
    if (cut < 1) continue
    var key = pairs[i].substring(0, cut)
    var value = pairs[i].substring(cut + 1)
    if (key === "state") out.state = value
    else if (key === "locale") out.locale = value
    else if (key === "rows") out.rows = parseInt(value, 10) || 0
    else if (key === "available") out.available = value === "" ? [] : value.split(",")
  }
  return out
}

// Tables are named for the locale without its codeset, the same shortening
// menu-translate does, so sl_SI.UTF-8 and sl_SI both find sl_SI.tsv.
function menuTableFor(available, lang) {
  var key = localeKey(lang)
  for (var i = 0; i < (available || []).length; i++) {
    if (localeKey(available[i]) === key) return available[i]
  }
  return ""
}

// The menu is the only translatable surface in the shell, so the panel says
// so plainly rather than implying the whole desktop moves with it.
function menuStatusText(status, rows, lang) {
  var table = menuTableFor(status.available, lang)
  if (table === "") return "No menu translation for " + describe(rows, lang) + " yet."
  if (status.state === "stale")
    return "Out of date: Omarchy's menu changed since these " + status.rows + " rows were copied."
  if (status.state === "on") return status.rows + " menu rows translated. Bar and panels stay English."
  return "Translate the Omarchy menu. Bar and panels stay English."
}

// polkit refusals and the shell's own "no agent" case are the failures worth
// naming: everything else localectl says is already a sentence.
function errorMessage(stderr, exitCode) {
  var text = String(stderr || "").trim().split("\n").pop()
  if (/not authorized|access denied|interactive authentication/i.test(text))
    return "Not authorized to change the system language"
  if (text !== "") return text.replace(/^Failed to (set locale|issue method call): /i, "")
  return "Could not set the system language (exit " + exitCode + ")"
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FORMAT_VARS: FORMAT_VARS,
    FOLLOW_LANGUAGE: FOLLOW_LANGUAGE,
    localeVarNames: localeVarNames,
    parseMenuStatus: parseMenuStatus,
    menuTableFor: menuTableFor,
    menuStatusText: menuStatusText,
    sessionIsStale: sessionIsStale,
    staleMessage: staleMessage,
    parseLocales: parseLocales,
    parseSystemLocale: parseSystemLocale,
    localeKey: localeKey,
    sameLocale: sameLocale,
    findRow: findRow,
    rowValue: rowValue,
    rowLabel: rowLabel,
    describe: describe,
    shortCode: shortCode,
    options: options,
    formatOptions: formatOptions,
    formatsValue: formatsValue,
    setLocaleArgs: setLocaleArgs,
    errorMessage: errorMessage
  }
}

// Unit tests for Model.js. Run: test/model-test.sh
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const M = require("../Model.js")

const tests = []
function test(name, fn) { tests.push([name, fn]) }

// --- parseLocales ----------------------------------------------------------

test("parseLocales reads the awk table and drops short lines", () => {
  const rows = M.parseLocales(
    "en_US.UTF-8\tAmerican English\tUnited States\n" +
    "aa_ER\tAfar\tEritrea\n" +
    "junk\n" +
    "\n")
  assert.deepEqual(rows, [
    { name: "en_US.UTF-8", language: "American English", territory: "United States" },
    { name: "aa_ER", language: "Afar", territory: "Eritrea" },
  ])
})

// --- parseSystemLocale -----------------------------------------------------

test("parseSystemLocale picks locale variables out of localectl status", () => {
  const vars = M.parseSystemLocale([
    "System Locale: LANG=de_DE.UTF-8",
    "               LC_TIME=en_GB.UTF-8",
    "    VC Keymap: slovene",
    "   X11 Layout: si",
    "  X11 Options: terminate:ctrl_alt_bksp",
  ].join("\n"))
  assert.deepEqual(vars, { LANG: "de_DE.UTF-8", LC_TIME: "en_GB.UTF-8" })
})

test("parseSystemLocale survives an unset locale", () => {
  assert.deepEqual(M.parseSystemLocale("System Locale: n/a\n VC Keymap: us"), {})
})

// --- localeKey / sameLocale ------------------------------------------------

test("localeKey collapses codeset spelling but keeps the modifier", () => {
  assert.equal(M.localeKey("sl_SI.UTF-8"), "sl_si")
  assert.equal(M.localeKey("sl_SI.utf8"), "sl_si")
  assert.equal(M.localeKey("aa_ER"), "aa_er")
  assert.equal(M.localeKey("be_BY.UTF-8@latin"), "be_by@latin")
  assert.equal(M.localeKey("be_BY@latin"), "be_by@latin")
  assert.equal(M.localeKey(""), "")
})

test("sameLocale never matches two blanks", () => {
  assert.equal(M.sameLocale("", ""), false)
  assert.equal(M.sameLocale("be_BY@latin", "be_BY.UTF-8"), false)
  assert.equal(M.sameLocale("en_US.utf8", "en_US.UTF-8"), true)
})

// --- rows ------------------------------------------------------------------

const rows = M.parseLocales([
  "en_US.UTF-8\tAmerican English\tUnited States",
  "sl_SI.UTF-8\tSlovenian\tSlovenia",
  "be_BY.UTF-8\tBelarusian\tBelarus",
  "be_BY@latin\tBelarusian\tBelarus",
  "aa_ER\tAfar\tEritrea",
].join("\n"))

test("rowValue answers with SUPPORTED's spelling, not the caller's", () => {
  assert.equal(M.rowValue(rows, "sl_SI.utf8"), "sl_SI.UTF-8")
  assert.equal(M.rowValue(rows, "C.UTF-8"), "")
  assert.equal(M.rowValue(rows, ""), "")
})

test("rowLabel separates locales that differ only by modifier", () => {
  assert.equal(M.rowLabel(M.findRow(rows, "be_BY.UTF-8")), "Belarusian (Belarus)")
  assert.equal(M.rowLabel(M.findRow(rows, "be_BY@latin")), "Belarusian (Belarus, latin)")
})

test("describe falls back to the raw name for a locale off the table", () => {
  assert.equal(M.describe(rows, "en_US.UTF-8"), "American English (United States)")
  assert.equal(M.describe(rows, "C.UTF-8"), "C.UTF-8")
  assert.equal(M.describe(rows, ""), "Not set")
})

test("shortCode takes the language half", () => {
  assert.equal(M.shortCode("sl_SI.UTF-8"), "SL")
  assert.equal(M.shortCode("be_BY@latin"), "BE")
  assert.equal(M.shortCode("aa_ER"), "AA")
  assert.equal(M.shortCode(""), "--")
})

test("options sort by label and carry the name as searchable description", () => {
  const opts = M.options(rows)
  assert.deepEqual(opts.map(o => o.label), [
    "Afar (Eritrea)",
    "American English (United States)",
    "Belarusian (Belarus)",
    "Belarusian (Belarus, latin)",
    "Slovenian (Slovenia)",
  ])
  assert.equal(opts[0].description, "aa_ER")
})

test("formatOptions lead with the follow-the-language choice", () => {
  const opts = M.formatOptions(rows)
  assert.equal(opts[0].value, M.FOLLOW_LANGUAGE)
  assert.equal(opts.length, rows.length + 1)
})

// --- formats ---------------------------------------------------------------

test("formatsValue treats unset and same-as-LANG alike", () => {
  assert.equal(M.formatsValue(rows, "sl_SI.UTF-8", ""), M.FOLLOW_LANGUAGE)
  assert.equal(M.formatsValue(rows, "sl_SI.UTF-8", "sl_SI.utf8"), M.FOLLOW_LANGUAGE)
  assert.equal(M.formatsValue(rows, "sl_SI.UTF-8", "en_US.UTF-8"), "en_US.UTF-8")
})

// --- setLocaleArgs ---------------------------------------------------------

test("setLocaleArgs sets LANG alone when formats follow the language", () => {
  assert.deepEqual(M.setLocaleArgs("sl_SI.UTF-8", ""), ["set-locale", "LANG=sl_SI.UTF-8"])
  assert.deepEqual(M.setLocaleArgs("sl_SI.UTF-8", "sl_SI.utf8"), ["set-locale", "LANG=sl_SI.UTF-8"])
})

test("setLocaleArgs spells out every format variable it owns", () => {
  const args = M.setLocaleArgs("de_DE.UTF-8", "en_GB.UTF-8")
  assert.equal(args[0], "set-locale")
  assert.equal(args[1], "LANG=de_DE.UTF-8")
  assert.deepEqual(args.slice(2), M.FORMAT_VARS.map(v => v + "=en_GB.UTF-8"))
})

// --- errorMessage ----------------------------------------------------------

test("errorMessage names a polkit refusal", () => {
  assert.equal(
    M.errorMessage("Failed to set locale: Interactive authentication required.", 1),
    "Not authorized to change the system language")
})

test("errorMessage passes localectl's own sentence through", () => {
  assert.equal(
    M.errorMessage("Failed to set locale: Specified locale is not installed: xx_XX", 1),
    "Specified locale is not installed: xx_XX")
  assert.equal(M.errorMessage("", 3), "Could not set the system language (exit 3)")
})

// --- locales.awk -----------------------------------------------------------
//
// The scanner is half the model: if it stops producing the names SUPPORTED
// spells, every lookup above is comparing against nothing.

test("locales.awk emits UTF-8 locales verbatim, with names", () => {
  const supported = "/usr/share/i18n/SUPPORTED"
  const fs = require("node:fs")
  if (!fs.existsSync(supported)) return console.log("    (skipped: no glibc locale table)")

  const out = execFileSync("awk", ["-f", path.join(__dirname, "..", "locales.awk"), supported], { encoding: "utf8" })
  const scanned = M.parseLocales(out)
  assert.ok(scanned.length > 100, "expected a few hundred locales, got " + scanned.length)

  // Every name has to appear in SUPPORTED exactly as emitted: that string is
  // what systemd matches before agreeing to generate a locale.
  const names = new Set(fs.readFileSync(supported, "utf8")
    .split("\n").filter(l => l.trim().endsWith(" UTF-8")).map(l => l.trim().split(/\s+/)[0]))
  for (const row of scanned) {
    assert.ok(names.has(row.name), row.name + " is not a UTF-8 entry in SUPPORTED")
    assert.notEqual(row.language, "", row.name + " has no language")
  }

  // C.UTF-8 names no language and must not be offered as one.
  assert.equal(M.findRow(scanned, "C.UTF-8"), null)
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log("  ok   " + name)
  } catch (error) {
    failed++
    console.log("  FAIL " + name + "\n       " + String(error.message).split("\n").join("\n       "))
  }
}
console.log(failed === 0 ? `\n${tests.length} passing` : `\n${failed} of ${tests.length} failing`)
process.exit(failed === 0 ? 0 : 1)

// Catalog lookup for the shell's user-visible strings. Kept Qt-free so the
// resolution rules can be unit tested under node (test/shell.d/translations-test.sh).
//
// Keys are the English source strings, not symbolic ids. A missing catalog,
// a missing key, or a key whose value is empty all resolve to the English
// source, so an untranslated string is a readable string rather than a blank
// or a "power.profile.header" leaking into the UI.

// LANG carries more than the language: sl_SI.UTF-8 names a region and a
// codeset too. Catalogs are looked up under both the region name and the bare
// language, so pt_BR.UTF-8 can carry Brazilian wording over a shared pt file
// without either having to repeat the other.
function baseLanguage(locale) {
  var value = String(locale || "").trim()
  if (value === "") return ""
  var cut = value.search(/[_.@]/)
  if (cut !== -1) value = value.substring(0, cut)
  return value.toLowerCase()
}

function regionLanguage(locale) {
  var value = String(locale || "").trim()
  if (value === "") return ""
  var at = value.indexOf("@")
  if (at !== -1) value = value.substring(0, at)
  var dot = value.indexOf(".")
  if (dot !== -1) value = value.substring(0, dot)
  if (value.indexOf("_") === -1) return ""
  return value
}

// C and POSIX are the absence of a language rather than a language, and a
// catalog named for either would be a mistake to load.
function isTranslatable(locale) {
  var base = baseLanguage(locale)
  return base !== "" && base !== "c" && base !== "posix"
}

function parseCatalog(text) {
  var parsed
  try {
    parsed = JSON.parse(String(text || ""))
  } catch (e) {
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  // A string entry is a translation; an object entry is a set of plural
  // categories. Anything else -- a number, a null, an empty string -- is
  // dropped so it falls back to English rather than rendering as itself.
  var out = {}
  for (var key in parsed) {
    var value = parsed[key]
    if (typeof value === "string" && value !== "") out[key] = value
    else if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value
  }
  return out
}

// Later catalogs win. Callers layer them shipped-then-user and bare-language
// -then-region, so a user's own file overrides what Omarchy ships and a
// regional wording overrides the shared one.
function mergeCatalogs(catalogs) {
  var out = {}
  for (var i = 0; i < (catalogs || []).length; i++) {
    var catalog = catalogs[i]
    if (!catalog) continue
    for (var key in catalog) out[key] = catalog[key]
  }
  return out
}

function translate(catalog, source) {
  var key = String(source === undefined || source === null ? "" : source)
  if (!catalog) return key
  var value = catalog[key]
  return typeof value === "string" && value !== "" ? value : key
}

// %1..%9, filled from the arguments in order. Placeholders rather than
// concatenation is what lets a translation put the value where its own
// grammar wants it: "Start weeks on %1" and "%1 se začne teden" carry the
// same argument in different places, and string concatenation at the call
// site can express only the first.
function format(text, args) {
  var values = args === undefined || args === null ? [] : (Array.isArray(args) ? args : [args])
  return String(text).replace(/%([1-9])/g, function (match, index) {
    var value = values[Number(index) - 1]
    return value === undefined || value === null ? match : String(value)
  })
}

// CLDR plural categories, integers only -- the shell counts things, it does
// not measure them. A language that is not listed falls through to the
// English shape, and every category falls back to "other", so an unlisted
// language and a catalog that only fills in "other" both still read.
//
// The families here cover what a European desktop actually meets, plus the
// three shapes that differ most from English: Slavic (Slovenian's dual
// included), east Asian (no agreement at all), and Arabic.
function pluralCategory(count, language) {
  var n = Math.abs(Math.floor(Number(count) || 0))
  var lang = baseLanguage(language)
  var mod10 = n % 10
  var mod100 = n % 100

  switch (lang) {
    // 1 naprava, 2 napravi, 3-4 naprave, 5+ naprav.
    case "sl":
      if (mod100 === 1) return "one"
      if (mod100 === 2) return "two"
      if (mod100 === 3 || mod100 === 4) return "few"
      return "other"

    case "ru": case "uk": case "be": case "sr": case "hr": case "bs":
      if (mod10 === 1 && mod100 !== 11) return "one"
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few"
      return "many"

    case "pl":
      if (n === 1) return "one"
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few"
      return "many"

    case "cs": case "sk":
      if (n === 1) return "one"
      if (n >= 2 && n <= 4) return "few"
      return "other"

    case "lt":
      if (mod10 === 1 && (mod100 < 11 || mod100 > 19)) return "one"
      if (mod10 >= 2 && mod10 <= 9 && (mod100 < 11 || mod100 > 19)) return "few"
      return "other"

    case "ar":
      if (n === 0) return "zero"
      if (n === 1) return "one"
      if (n === 2) return "two"
      if (mod100 >= 3 && mod100 <= 10) return "few"
      if (mod100 >= 11 && mod100 <= 99) return "many"
      return "other"

    // No number agreement: one form covers every count.
    case "ja": case "zh": case "ko": case "th": case "vi": case "id": case "ms":
      return "other"

    case "fr":
      return n === 0 || n === 1 ? "one" : "other"

    default:
      return n === 1 ? "one" : "other"
  }
}

// The singular is the catalog key, and its entry is an object of categories.
// Both English forms stay at the call site, so an untranslated shell still
// counts correctly in English -- the same rule as every other string here.
function translatePlural(catalog, count, singular, other, language) {
  var entry = catalog ? catalog[String(singular)] : undefined
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    var category = pluralCategory(count, language)
    var picked = entry[category]
    if (typeof picked !== "string" || picked === "") picked = entry.other
    if (typeof picked === "string" && picked !== "") return format(picked, count)
  }
  // A plural key translated to a single string is a mistake in the catalog,
  // not a form: it would read wrong at every count but one. English is the
  // safer answer.
  return format(pluralCategory(count, "en") === "one" ? singular : other, count)
}

// QML imports this file as a plain script; node needs the exports to test it.
// The guard is what keeps the same file usable from both.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    baseLanguage: baseLanguage,
    regionLanguage: regionLanguage,
    isTranslatable: isTranslatable,
    parseCatalog: parseCatalog,
    mergeCatalogs: mergeCatalogs,
    translate: translate,
    format: format,
    pluralCategory: pluralCategory,
    translatePlural: translatePlural
  }
}

import QtQuick
import Quickshell
import Quickshell.Io
import "Translations.js" as Catalogs

// The panel's strings, read from a catalog at runtime rather than written into
// the QML in one language.
//
// A plugin cannot add a singleton to qs.Commons, so this is an ordinary
// component the panel instantiates once. That is also why it reads only the
// user's own directory: a plugin has nowhere shipped to read from, and there
// is no second copy of the catalog to drift out of sync.
//
//   ~/.config/omarchy/locales/<language>.json    e.g. sl.json
//   ~/.config/omarchy/locales/<language>_<REGION>.json
//
// Both are watched, so editing a translation shows up without a restart. No
// catalog at all is the normal case and reads as English, which is also the
// source of every key.
QtObject {
  id: root

  readonly property string locale: Quickshell.env("OMARCHY_LANGUAGE") || Quickshell.env("LANG") || ""
  readonly property bool active: Catalogs.isTranslatable(locale)
  readonly property string language: active ? Catalogs.baseLanguage(locale) : ""
  readonly property string region: active ? Catalogs.regionLanguage(locale) : ""
  readonly property string directory: Quickshell.env("HOME") + "/.config/omarchy/locales/"

  // Reading `catalog` inside t() is what makes every call site a binding on
  // it: when the file lands or changes, the strings re-resolve on their own.
  readonly property var catalog: Catalogs.mergeCatalogs([languageFile.entries, regionFile.entries])

  function t(source, args) {
    var translated = Catalogs.translate(root.catalog, source)
    return args === undefined ? translated : Catalogs.format(translated, args)
  }

  function plural(count, singular, other) {
    return Catalogs.translatePlural(root.catalog, count, singular, other, root.locale)
  }

  component Catalog: FileView {
    property var entries: ({})
    property string language: ""
    property string directory: ""
    path: language === "" ? "" : directory + language + ".json"
    watchChanges: true
    printErrors: false
    onLoaded: entries = Catalogs.parseCatalog(text())
    onLoadFailed: entries = ({})
    onFileChanged: reload()
  }

  readonly property Catalog languageFile: Catalog { directory: root.directory; language: root.language }
  readonly property Catalog regionFile: Catalog { directory: root.directory; language: root.region }
}

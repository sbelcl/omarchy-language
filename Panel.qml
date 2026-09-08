import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

// Bar widget for the system language.
//
// Omarchy ships English only and has no locale selector anywhere: the
// installer asks for a keyboard layout and derives nothing else from it, so
// LANG stays en_US.UTF-8 until someone edits /etc/locale.gen by hand. This
// widget is that edit, done from the bar.
//
// Everything privileged goes through `localectl set-locale`. systemd-localed
// on Arch is built with locale-gen support, so it will uncomment the locale
// in /etc/locale.gen, run locale-gen, and write /etc/locale.conf in one call
// -- a locale nobody has generated yet costs a few seconds, not a terminal.
// The polkit prompt for org.freedesktop.locale1.set-locale is answered by
// Omarchy's own agent (omarchy.polkit), so no sudo and no pkexec-ing a
// script out of a user-writable plugin directory.
//
// The one thing this cannot do is apply the change to the session it is
// running in: LANG is read at login. Hence the log-out row.
Panel {
  id: root
  moduleName: "imnos.language"
  ipcTarget: "imnos.language"

  // ---- settings -----------------------------------------------------------
  readonly property bool iconLabel: setting("display", "Code") === "Icon"
  readonly property string glyph: "󰗊"

  // ---- state --------------------------------------------------------------
  property var locales: []           // [{ name, language, territory }]
  property var localeVars: ({})      // LANG / LC_* as localectl reports them
  property bool applying: false
  property string errorText: ""
  property string applyStderr: ""
  property string menuError: ""
  property int applyExitCode: 0
  property bool cursorActive: false
  property string focusSection: "language"

  // `menu-translate status` output: the Omarchy menu is the one surface in
  // the shell that is data rather than QML string literals, so it is the one
  // surface a plugin can translate. Everything else stays English.
  property var menuStatus: ({ state: "off", locale: "", rows: 0, available: [] })
  property bool menuBusy: false
  readonly property string menuTable: Model.menuTableFor(menuStatus.available, systemLang)
  readonly property bool menuAvailable: menuTable !== ""
  readonly property bool menuOn: menuStatus.state !== "off"

  // The locale this session was handed at login. The shell process inherits
  // it from the session, and nothing short of logging out replaces it, which
  // is exactly what makes it the right thing to compare against.
  readonly property var sessionVars: {
    var names = Model.localeVarNames()
    var out = {}
    for (var i = 0; i < names.length; i++) {
      var value = Quickshell.env(names[i])
      if (value) out[names[i]] = String(value)
    }
    return out
  }

  readonly property string staleText: Model.staleMessage(locales, localeVars, sessionVars)
  readonly property bool needsLogout: staleText !== ""

  readonly property string systemLang: String(localeVars.LANG || "")
  readonly property string languageValue: Model.rowValue(locales, systemLang)
  readonly property string formatsValue: Model.formatsValue(locales, systemLang, localeVars.LC_TIME || "")
  readonly property string barLabel: iconLabel ? glyph : Model.shortCode(systemLang)
  readonly property var languageOptions: Model.options(locales)
  readonly property var formatOptions: Model.formatOptions(locales)

  // Sections the cursor can reach. Rows that are not on screen are not in the
  // ring: the log-out row only exists once there is something to log out for,
  // and the refresh only while the copied menu has fallen behind.
  readonly property var sections: {
    var list = ["language", "formats"]
    if (menuAvailable) list.push("menu")
    if (menuStatus.state === "stale") list.push("menu-refresh")
    if (needsLogout) list.push("logout")
    return list
  }

  function refresh() {
    if (!statusProc.running) statusProc.running = true
    if (!menuStatusProc.running) menuStatusProc.running = true
  }

  function runMenuTranslate(verb, argument) {
    if (menuBusy) return
    menuBusy = true
    var command = ["bash", pluginDir + "menu-translate", verb]
    if (argument) command.push(argument)
    menuProc.command = command
    menuProc.running = true
  }

  // The shell watches the extension file, so the menu picks this up without a
  // restart -- nothing to log out for here.
  function toggleMenuTranslation() {
    if (!menuAvailable) return
    if (menuOn) runMenuTranslate("remove")
    else runMenuTranslate("apply", menuTable)
  }

  function loadLocales() {
    if (!scanProc.running) scanProc.running = true
  }

  // A pick that matches what is already in force is a no-op rather than a
  // polkit prompt for nothing -- the dropdowns re-emit on every refresh.
  function applyLocale(lang, formats) {
    if (applying || String(lang || "") === "") return
    if (Model.sameLocale(lang, systemLang)
      && String(formats || "") === formatsValue) return

    errorText = ""
    applyStderr = ""
    applyExitCode = 0
    applying = true
    applyProc.command = ["localectl"].concat(Model.setLocaleArgs(lang, formats))
    applyProc.running = true
  }

  function finishApply() {
    applying = false
    errorText = applyExitCode === 0 ? "" : Model.errorMessage(applyStderr, applyExitCode)
    // Either way, re-read: a partial success (LANG took, an LC_* did not)
    // should leave the dropdowns showing what actually landed.
    refresh()
  }

  function logOut() {
    close()
    // Through a login shell, so /usr/share/omarchy/bin is on PATH.
    Util.execArgv(["omarchy-system-logout"])
  }

  function moveCursor(delta) {
    var list = sections
    var index = list.indexOf(focusSection)
    if (index < 0) index = 0
    focusSection = list[(index + delta + list.length) % list.length]
  }

  function activateCursor() {
    if (focusSection === "language") languageDropdown.toggle()
    else if (focusSection === "formats") formatsDropdown.toggle()
    else if (focusSection === "menu") toggleMenuTranslation()
    else if (focusSection === "menu-refresh") runMenuTranslate("apply", menuTable)
    else if (focusSection === "logout") logOut()
  }

  // The plugin's own directory, for the awk program next to this file.
  // Quickshell hands Process an argv, not a shell line, so the path travels
  // as one argument however it is spelled.
  readonly property string pluginDir: {
    var url = String(Qt.resolvedUrl("."))
    return url.indexOf("file://") === 0 ? url.substring(7) : url
  }

  Component.onCompleted: {
    loadLocales()
    refresh()
  }

  onOpenedChanged: {
    if (!opened) return
    cursorActive = false
    focusSection = "language"
    // localectl is cheap and the file it reads can change under us (a hand
    // edit, another session), so re-read rather than trust what we cached.
    refresh()
    if (locales.length === 0) loadLocales()
  }

  Process {
    id: scanProc
    command: ["awk", "-f", root.pluginDir + "locales.awk", "/usr/share/i18n/SUPPORTED"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.locales = Model.parseLocales(text)
    }
  }

  Process {
    id: statusProc
    command: ["localectl", "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.localeVars = Model.parseSystemLocale(text)
    }
  }

  Process {
    id: menuStatusProc
    command: ["bash", root.pluginDir + "menu-translate", "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.menuStatus = Model.parseMenuStatus(text)
    }
  }

  Process {
    id: menuProc
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.menuError = String(text || "").trim()
    }
    onExited: function(exitCode) {
      root.menuBusy = false
      if (exitCode !== 0 && root.menuError === "")
        root.menuError = "Could not write the menu translation"
      if (exitCode === 0) root.menuError = ""
      menuStatusProc.running = true
    }
  }

  Process {
    id: applyProc
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applyStderr = String(text || "").trim()
    }
    // The exit and stream-finished signals have no guaranteed order, and the
    // message localectl failed with is the whole point of reporting a failure.
    // Settling one turn of the event loop later means both have landed.
    onExited: function(exitCode) {
      root.applyExitCode = exitCode
      Qt.callLater(root.finishApply)
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barLabel
    fontSize: root.iconLabel ? Style.font.icon : Style.font.caption
    horizontalMargin: 6
    tooltipText: Model.describe(root.locales, root.systemLang)
    onPressed: function() { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // While a dropdown owns the keys its own search field is taking them,
      // and the panel cursor has to stay out of the way.
      blocked: languageDropdown.popupOpen || formatsDropdown.popupOpen
      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: if (root.cursorActive) root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero: glyph · title · locale in force ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: root.glyph
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Language"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: Model.describe(root.locales, root.systemLang).toUpperCase()
              color: Qt.darker(root.bar.foreground, 1.4)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }
        }

        PanelSeparator { foreground: root.bar.foreground }

        // ---------- Display language ----------
        Column {
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: "DISPLAY LANGUAGE"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          SearchableDropdown {
            id: languageDropdown
            width: parent.width
            showLabel: false
            enabled: !root.applying && root.locales.length > 0
            opacity: enabled ? 1 : 0.5
            fontFamily: root.bar.fontFamily
            placeholderText: "Search languages..."
            emptyText: "No such language"
            options: root.languageOptions
            value: root.languageValue
            hasCursor: root.cursorActive && root.focusSection === "language"
            onHovered: function(isHovered) {
              if (isHovered) { root.cursorActive = true; root.focusSection = "language" }
            }
            onChanged: function(picked) { root.applyLocale(picked, root.formatsValue) }
          }
        }

        // ---------- Formats ----------
        Column {
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: "FORMATS"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
            text: "Dates, numbers, currency, paper size and units."
            color: Qt.darker(root.bar.foreground, 1.5)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }

          SearchableDropdown {
            id: formatsDropdown
            width: parent.width
            showLabel: false
            enabled: !root.applying && root.locales.length > 0
            opacity: enabled ? 1 : 0.5
            fontFamily: root.bar.fontFamily
            placeholderText: "Search regions..."
            emptyText: "No such region"
            options: root.formatOptions
            value: root.formatsValue
            hasCursor: root.cursorActive && root.focusSection === "formats"
            onHovered: function(isHovered) {
              if (isHovered) { root.cursorActive = true; root.focusSection = "formats" }
            }
            onChanged: function(picked) { root.applyLocale(root.languageValue, picked) }
          }
        }

        // ---------- Omarchy menu ----------
        PanelSeparator {
          visible: root.menuAvailable
          foreground: root.bar.foreground
        }

        Column {
          visible: root.menuAvailable
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: "OMARCHY MENU"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          Item {
            width: parent.width
            implicitHeight: Math.max(menuSwitch.implicitHeight, menuCaption.implicitHeight)

            ToggleSwitch {
              id: menuSwitch
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              checked: root.menuOn
              busy: root.menuBusy
              foreground: root.bar.foreground
              hasCursor: root.cursorActive && root.focusSection === "menu"
              onHovered: function(isHovered) {
                if (isHovered) { root.cursorActive = true; root.focusSection = "menu" }
              }
              onToggled: root.toggleMenuTranslation()
            }

            Text {
              id: menuCaption
              anchors.left: menuSwitch.right
              anchors.leftMargin: Style.space(12)
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
              text: root.menuError !== ""
                ? root.menuError
                : Model.menuStatusText(root.menuStatus, root.locales, root.systemLang)
              color: root.menuError !== "" ? Color.urgent : Qt.darker(root.bar.foreground, 1.3)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }

          Button {
            visible: root.menuStatus.state === "stale"
            width: parent.width
            text: "Refresh translation"
            iconText: "󰑐"
            fontSize: Style.font.bodySmall
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            hasCursor: root.cursorActive && root.focusSection === "menu-refresh"
            onClicked: root.runMenuTranslate("apply", root.menuTable)
            onHovered: function(isHovered) {
              if (isHovered) { root.cursorActive = true; root.focusSection = "menu-refresh" }
            }
          }
        }

        // ---------- Status ----------
        // One line, three states, and it keeps its height so picking a
        // language doesn't shove the dropdowns up the panel.
        Text {
          width: parent.width
          visible: root.applying || root.needsLogout || root.errorText !== ""
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: {
            if (root.errorText !== "") return root.errorText
            if (root.applying) return "Applying... a language that has never been generated takes a moment."
            return root.staleText
          }
          color: root.errorText !== "" ? Color.urgent : Qt.darker(root.bar.foreground, 1.3)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Button {
          visible: root.needsLogout
          width: parent.width
          text: "Log out"
          iconText: "󰍃"
          fontSize: Style.font.bodySmall
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          bordered: true
          hasCursor: root.cursorActive && root.focusSection === "logout"
          onClicked: root.logOut()
          onHovered: function(isHovered) {
            if (isHovered) { root.cursorActive = true; root.focusSection = "logout" }
          }
        }
      }
    }
  }
}

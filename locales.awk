# Every UTF-8 locale glibc supports, named the way locale-gen and
# systemd-localed both expect, with an English language and territory to
# show for it.
#
# The name is /usr/share/i18n/SUPPORTED's first field, verbatim. That
# field is what systemd compares a requested locale against before it
# agrees to generate one, and it is also the name locale-gen hands to
# localedef -- so it is the only spelling that is guaranteed to survive
# the whole round trip. Roughly half the entries carry a codeset
# (en_US.UTF-8) and half do not (aa_ER, be_BY@latin); neither form may be
# rewritten into the other.
#
# The names come from the LC_IDENTIFICATION block of the locale's own
# source file, so this table tracks whatever glibc ships rather than a
# hand-kept list that would rot. C.UTF-8 names no language and is dropped:
# it is a fallback, not something to offer as a system language.
#
# Emits: name<TAB>language<TAB>territory

$2 == "UTF-8" {
  name = $1

  # ca_ES@valencia lives in locales/ca_ES@valencia, en_US.UTF-8 in
  # locales/en_US: the codeset is dropped from the path, the modifier kept.
  base = name
  sub(/\.UTF-8$/, "", base)
  file = "/usr/share/i18n/locales/" base

  language = ""
  territory = ""
  while ((getline line < file) > 0) {
    if (language == "" && line ~ /^language[ \t]+"/) {
      language = line
      sub(/^language[ \t]+"/, "", language)
      sub(/".*$/, "", language)
    } else if (territory == "" && line ~ /^territory[ \t]+"/) {
      territory = line
      sub(/^territory[ \t]+"/, "", territory)
      sub(/".*$/, "", territory)
    }
    if (language != "" && territory != "") break
  }
  close(file)

  if (language != "") print name "\t" language "\t" territory
}

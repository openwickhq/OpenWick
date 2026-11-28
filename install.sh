#!/bin/sh
# OpenWick installer for macOS and Linux. One command:
#
#   curl -fsSL https://raw.githubusercontent.com/openwickhq/OpenWick/main/install.sh | sh
#
# What it does, all inside your home folder (no sudo, no admin rights):
#   1. Uses your Node.js 18+ if you have it; otherwise downloads Node.js from nodejs.org into
#      ~/.openwick/node (checksum-verified). Nothing is installed system-wide.
#   2. Downloads the latest OpenWick release into ~/.openwick/app.
#   3. Adds a `openwick` command (~/.local/bin) and an app-menu entry, then starts it.
# Run it again to update; your watchlists, drawings, alerts and indicators are kept.
#
# Options (environment variables):
#   OPENWICK_HOME=/path       install somewhere else (default ~/.openwick)
#   OPENWICK_SOURCE=file|url  install from this .tar.gz instead of the latest release
#   OPENWICK_NO_START=1       don't start it at the end
#   OPENWICK_NO_PATH=1        don't add ~/.local/bin to your shell's PATH
set -eu

REPO="${OPENWICK_REPO:-openwickhq/OpenWick}"   # GitHub "owner/name", set when publishing
APP_ID="openwick"
APP_NAME="OpenWick"
NODE_LINE="latest-v24.x"                       # long-term-support Node.js, if one is needed
HOME_DIR="${OPENWICK_HOME:-$HOME/.openwick}"
BIN_DIR="$HOME/.local/bin"

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch URL FILE
  if have curl; then curl -fsSL --retry 2 -o "$2" "$1"
  elif have wget; then wget -q -O "$2" "$1"
  else die "Needs curl or wget to download. Install one and run this again."; fi
}
sha256() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "Needs sha256sum or shasum to check downloads."; fi
}

say ""
say "  $APP_NAME installer. Created by Sourav Chakraborty, open source (MIT)."
say "  Installs into $HOME_DIR. No admin rights needed."

have tar || die "Needs tar to unpack the download."
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t owinstall)"
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir -p "$HOME_DIR"
# Marks this folder as made by the installer, so "openwick uninstall" may remove it.
echo "$APP_NAME install folder. Remove with: $APP_ID uninstall" > "$HOME_DIR/.openwick-install"

# ---------- 1. Node.js ----------
step "1/4  Node.js"
NODE=""
node_ok() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; }
if [ -x "$HOME_DIR/node/bin/node" ] && node_ok "$HOME_DIR/node/bin/node"; then
  NODE="$HOME_DIR/node/bin/node"; say "Using $APP_NAME's own Node.js $("$NODE" -v)."
elif have node && node_ok "$(command -v node)"; then
  NODE="$(command -v node)"; say "Using your Node.js $("$NODE" -v)."
else
  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    *) die "This installer is for macOS and Linux. On Windows use install.ps1." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) die "No ready-made Node.js for this processor ($(uname -m)). Install Node.js 18+ yourself, then run this again." ;;
  esac
  say "Node.js 18+ not found. Downloading it from nodejs.org into $HOME_DIR/node (only $APP_NAME uses it)."
  BASE="https://nodejs.org/dist/$NODE_LINE"
  fetch "$BASE/SHASUMS256.txt" "$TMP/SHASUMS256.txt"
  FILE="$(grep -E " node-v[0-9.]+-$OS-$ARCH\.tar\.gz\$" "$TMP/SHASUMS256.txt" | head -n1 | awk '{print $2}')"
  [ -n "$FILE" ] || die "Couldn't find Node.js for $OS-$ARCH on nodejs.org."
  WANT="$(grep " $FILE\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  fetch "$BASE/$FILE" "$TMP/$FILE"
  [ "$(sha256 "$TMP/$FILE")" = "$WANT" ] || die "The Node.js download didn't match its checksum. Try again."
  rm -rf "$HOME_DIR/node" && mkdir -p "$HOME_DIR/node"
  tar -xzf "$TMP/$FILE" -C "$HOME_DIR/node" --strip-components=1
  NODE="$HOME_DIR/node/bin/node"
  node_ok "$NODE" || die "The downloaded Node.js doesn't run on this computer."
  say "Node.js $("$NODE" -v) ready."
fi

# ---------- 2. OpenWick ----------
step "2/4  $APP_NAME"
ARCHIVE="$TMP/app.tar.gz"
if [ -n "${OPENWICK_SOURCE:-}" ]; then
  case "$OPENWICK_SOURCE" in
    http://*|https://*) fetch "$OPENWICK_SOURCE" "$ARCHIVE" ;;
    *) [ -f "$OPENWICK_SOURCE" ] || die "No file at $OPENWICK_SOURCE"; cp "$OPENWICK_SOURCE" "$ARCHIVE" ;;
  esac
  say "From $OPENWICK_SOURCE"
else
  case "$REPO" in OWNER/*) die "This copy of the installer doesn't know its GitHub address yet (run scripts/set-repo.js before publishing)." ;; esac
  if fetch "https://github.com/$REPO/releases/latest/download/$APP_ID.tar.gz" "$ARCHIVE" 2>/dev/null; then
    say "Latest release from github.com/$REPO"
  else
    say "No release yet; using the newest code from github.com/$REPO"
    fetch "https://github.com/$REPO/archive/refs/heads/main.tar.gz" "$ARCHIVE"
  fi
fi
NEW="$HOME_DIR/app.new"
rm -rf "$NEW" && mkdir -p "$NEW"
tar -xzf "$ARCHIVE" -C "$NEW" --strip-components=1
[ -f "$NEW/server.js" ] || die "The download doesn't look like $APP_NAME (no server.js)."

APP="$HOME_DIR/app"
if [ -d "$APP" ]; then
  say "Updating. Your data is kept."
  "$NODE" "$APP/scripts/stop.js" >/dev/null 2>&1 || true
  # Keep everything you made: the data folder and your own indicators.
  [ -d "$APP/data" ] && cp -R "$APP/data" "$NEW/"
  if [ -d "$APP/custom" ]; then
    mkdir -p "$NEW/custom"
    for f in "$APP/custom"/*; do
      [ -e "$f" ] || continue
      [ -e "$NEW/custom/$(basename "$f")" ] || cp -R "$f" "$NEW/custom/"
    done
  fi
  rm -rf "$HOME_DIR/app.old" && mv "$APP" "$HOME_DIR/app.old"
fi
mv "$NEW" "$APP"
rm -rf "$HOME_DIR/app.old"
VERSION="$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$APP/package.json" 2>/dev/null || echo "")"
say "$APP_NAME ${VERSION:+$VERSION }is in $APP"

# ---------- 3. The openwick command and a menu entry ----------
step "3/4  Shortcuts"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/$APP_ID" <<EOF
#!/bin/sh
# $APP_NAME: start, stop, update or uninstall. Run "$APP_ID help".
NODE="$NODE"
[ -x "\$NODE" ] || NODE=node
OPENWICK_HOME="$HOME_DIR" exec "\$NODE" "$APP/scripts/cli.js" "\$@"
EOF
chmod +x "$BIN_DIR/$APP_ID"
say "Command: $APP_ID  ($BIN_DIR/$APP_ID)"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    if [ "${OPENWICK_NO_PATH:-}" != "1" ]; then
      case "${SHELL:-}" in
        */zsh) RC="$HOME/.zshrc" ;;
        */bash) RC="$HOME/.bashrc" ;;
        *) RC="$HOME/.profile" ;;
      esac
      if ! grep -qs "# added by $APP_NAME" "$RC"; then
        printf '\nexport PATH="$HOME/.local/bin:$PATH"  # added by %s\n' "$APP_NAME" >> "$RC"
        say "Added ~/.local/bin to your PATH in $RC (open a new terminal to use \"$APP_ID\")."
      fi
    fi
    ;;
esac

if [ "$(uname -s)" = "Linux" ]; then
  APPS="$HOME/.local/share/applications"
  mkdir -p "$APPS"
  cat > "$APPS/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Charts for stocks, indices and crypto
Exec=$BIN_DIR/$APP_ID
Icon=$APP/public/img/logo.svg
Terminal=false
Categories=Office;Finance;
EOF
  say "Added $APP_NAME to your app menu."
elif [ "$(uname -s)" = "Darwin" ]; then
  BUNDLE="$HOME/Applications/$APP_NAME.app"
  mkdir -p "$BUNDLE/Contents/MacOS"
  cat > "$BUNDLE/Contents/MacOS/$APP_ID" <<EOF
#!/bin/sh
exec "$BIN_DIR/$APP_ID" start
EOF
  chmod +x "$BUNDLE/Contents/MacOS/$APP_ID"
  cat > "$BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>$APP_NAME</string>
<key>CFBundleExecutable</key><string>$APP_ID</string>
<key>CFBundleIdentifier</key><string>local.$APP_ID</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
  say "Added $APP_NAME to ~/Applications."
fi

# ---------- 4. Start ----------
step "4/4  Start"
if [ "${OPENWICK_NO_START:-}" = "1" ]; then
  say "Skipped (OPENWICK_NO_START=1)."
else
  OPENWICK_HOME="$HOME_DIR" "$NODE" "$APP/scripts/cli.js" start || die "It didn't start. Run \"$BIN_DIR/$APP_ID doctor\" to see why."
fi

say ""
say "Done. Next time:"
say "  $APP_ID            start it and open your browser"
say "  $APP_ID stop       stop it"
say "  $APP_ID update     get the newest version (keeps your data)"
say "  $APP_ID uninstall  remove it"
say ""

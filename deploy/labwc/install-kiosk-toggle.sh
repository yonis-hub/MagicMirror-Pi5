#!/usr/bin/env bash
# install-kiosk-toggle.sh -- bind Ctrl+Alt+K to toggle-kiosk.sh in labwc.
#
# Run once on the Pi as the desktop user (not root), e.g. over SSH:
#   bash ~/MagicMirror-Pi5/deploy/labwc/install-kiosk-toggle.sh
# Safe to re-run: if the binding is already there it changes nothing.
#
# The repo never recorded this binding. On MM01 it had been added by hand and
# ran toggle-kiosk.sh directly, but the script was checked out without its
# exec bit, so Ctrl+Alt+K silently did nothing. This makes the binding
# reproducible: it adds one <keybind> to the existing <keyboard> section of
# ~/.config/labwc/rc.xml (timestamped backup first) instead of replacing the
# file, because Pi OS's Control Centre keeps mouse and keyboard settings in
# there too. labwc is then told to reload, so no logout is needed.

set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the desktop user, not with sudo." >&2
  exit 1
fi

TOGGLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/toggle-kiosk.sh"
RC="${XDG_CONFIG_HOME:-$HOME/.config}/labwc/rc.xml"
KEY="${KIOSK_TOGGLE_KEY:-C-A-k}"

# Without --merge-config, labwc reads only the first rc.xml it finds, and a
# user rc.xml that defines any keybind drops the built-in defaults (Alt+Tab,
# Alt+F4, ...) unless it also contains <default/>. Pi OS starts labwc with -m,
# which layers the user file over /etc/xdg/labwc/rc.xml instead; there,
# <default/> would override Pi OS's own media-key bindings. So add <default/>
# only when labwc is running without merge.
labwc_args="$(ps -o args= -C labwc 2>/dev/null || true)"
merge=1
if [[ -z "$labwc_args" ]]; then
  echo "Note: labwc is not running; assuming Pi OS's usual --merge-config."
elif ! grep -Eq -- '(^|[[:space:]])(-m|--merge-config)([[:space:]]|$)' <<<"$labwc_args"; then
  merge=0
fi

python3 - "$RC" "$KEY" "bash $TOGGLE" "$merge" <<'PY'
import os
import shutil
import sys
import time
import xml.etree.ElementTree as ET

rc, key, command, merge = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"

if os.path.exists(rc):
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    tree = ET.parse(rc, parser=parser)
    root = tree.getroot()
else:
    root = ET.Element("labwc_config")
    tree = ET.ElementTree(root)

# Pi OS writes <openbox_config xmlns="http://openbox.org/3.4/rc">; labwc
# accepts that root too. Keep whatever namespace is there.
ns = root.tag[1:].split("}", 1)[0] if root.tag.startswith("{") else ""
if ns:
    ET.register_namespace("", ns)


def q(tag):
    return "{%s}%s" % (ns, tag) if ns else tag


# An older hand-made binding runs the script directly ("/path/toggle-kiosk.sh",
# no "bash" in front) -- that is the same binding, not a conflict.
toggle = command.split()[-1]

for kb in root.iter(q("keybind")):
    if kb.get("key", "").lower() == key.lower():
        cmds = [a.get("command") or "" for a in kb.iter(q("action"))]
        if any(c.split()[-1:] == [toggle] for c in cmds):
            print(f"{key} is already bound to the kiosk toggle; nothing to change.")
            sys.exit(0)
        sys.exit(f"{rc} already binds {key} to {cmds}; not overwriting it. "
                 f"Set KIOSK_TOGGLE_KEY to use a different key.")

keyboard = root.find(q("keyboard"))
if keyboard is None:
    keyboard = ET.SubElement(root, q("keyboard"))
if not merge and keyboard.find(q("default")) is None:
    keyboard.insert(0, ET.Element(q("default")))
kb = ET.SubElement(keyboard, q("keybind"), {"key": key})
ET.SubElement(kb, q("action"), {"name": "Execute", "command": command})

if os.path.exists(rc):
    backup = rc + time.strftime(".bak.%Y%m%d-%H%M%S")
    shutil.copy2(rc, backup)
    print(f"Backed up {rc} -> {backup}")
else:
    os.makedirs(os.path.dirname(rc), exist_ok=True)

ET.indent(tree, space="  ")
tree.write(rc, encoding="UTF-8", xml_declaration=True)
print(f"Bound {key} to '{command}' in {rc}")
PY

# labwc reloads rc.xml on SIGHUP (what `labwc --reconfigure` sends; that
# command needs LABWC_PID, which an SSH shell doesn't have).
if pkill -HUP -x labwc; then
  echo "labwc reloaded. Press Ctrl+Alt+K on the Pi's keyboard to hide/show the mirror."
else
  echo "labwc is not running; the binding takes effect at the next desktop login."
fi

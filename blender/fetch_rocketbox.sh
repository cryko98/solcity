#!/bin/sh
# blender/fetch_rocketbox.sh <Group> <Avatar> ... (run in vendor/rocketbox): an avatar's FBX (Export/) and textures from github.com/microsoft/Microsoft-Rocketbox
group=$1; shift
raw="https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/$group"
api="https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/$group"
for a in "$@"; do
  [ -f "$a/$a.fbx" ] && [ -f "$a/Textures/.done" ] && { echo "have $a"; continue; }
  mkdir -p "$a/Textures"
  curl -sSfL -o "$a/$a.fbx" "$raw/$a/Export/$a.fbx" || echo "fail fbx $a"
  curl -sS "$api/$a/Textures" | grep '"name"' | sed 's/.*"name": "\(.*\)".*/\1/' | grep -i '\.tga$' | grep -v wrinkle | while read f; do
    curl -sSfL -o "$a/Textures/$f" "$raw/$a/Textures/$f" || echo "fail $a/$f"
  done
  touch "$a/Textures/.done"
  echo "got $a $(du -sh "$a" | cut -f1)"
done

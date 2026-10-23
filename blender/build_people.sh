#!/bin/sh
# The people of the city (assets/models/people/<Avatar>.glb): Rocketbox avatars (MIT) as bodies
# alone, small textures (512, WebP: the hair keeps its alpha). They play the hero's clips from
# rb_hero.glb (same Bip01 skeleton). The FBX and textures: blender/fetch_rocketbox.sh, e.g.
#   (cd vendor/rocketbox && sh ../../blender/fetch_rocketbox.sh Adults Male_Adult_01 && sh ../../blender/fetch_rocketbox.sh Professions Police_Male_01)
BLENDER=${BLENDER:-"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"}
mkdir -p assets/models/people
for a in ${@:-Male_Adult_01 Male_Adult_03 Male_Adult_05 Male_Adult_08 Male_Adult_14 Male_Adult_18 Business_Male_02 \
  Female_Adult_01 Female_Adult_03 Female_Adult_05 Female_Adult_08 Female_Adult_12 Female_Adult_15 Business_Female_02 \
  Police_Male_01 Police_Male_03 Police_Female_01}; do
  [ -f "vendor/rocketbox/$a/$a.fbx" ] || { echo "missing $a"; continue; }
  "$BLENDER" -b --factory-startup -P blender/build_rocketbox.py -- . "$a" "assets/models/people/$a.glb" tex=512 img=webp 2>&1 | grep -E "EXPORTED|Error"
done

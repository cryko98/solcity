#!/bin/sh
# The hero (assets/models/rb_hero.glb): a Rocketbox avatar with motion from the Rocketbox library,
# CMU motion capture and Quaternius's animation libraries (see build_rocketbox.py for where each
# lives under vendor/). Then its animation keys thinned out (gltf-transform resample).
BLENDER=${BLENDER:-"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"}
OUT=assets/models/rb_hero.glb
"$BLENDER" -b --factory-startup -P blender/build_rocketbox.py -- . Male_Adult_11 "$OUT" \
  idle=m_idle_neutral_01 walk=m_walk_neutral_01 run=m_run_neutral_01 sprint=m_run_fast_01 \
  standtalk=m_gestic_talk_neutral_01 standlisten=m_gestic_listen_neutral_01 dance=m_dancing_cool \
  guard=cmu:14_01@1081-1113^like:punchr punchl=cmu:14_01@265-321^aim punchr=cmu:14_01@1021-1081^aim \
  hit=ual1:Hit_Head knockdown=cmu:90_18@70-300 getup=ual2:LayToIdle \
  jump=ual1:Jump_Loop roll=ual1:Roll swim=ual1:Swim_Fwd_Loop tread=ual1:Swim_Idle_Loop \
  drive=ual1:Driving_Loop sittalk=ual1:Sitting_Talking_Loop sitlisten=ual1:Sitting_Idle_Loop \
  pistol_aim=ual1:Pistol_Aim_Neutral pistol_hold=ual1:Pistol_Idle_Loop || exit 1
npx -y @gltf-transform/cli@4.1.1 resample "$OUT" "$OUT" --tolerance 0.0002

// Fix-ups for materials exported from the Blender people models.
import * as THREE from 'three';

// hair cards carry their strands in the texture alpha: cut them out, show both sides
export function prepareCharacter(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.name === 'HairCards') {
        m.alphaTest = 0.45;
        m.transparent = false;
        m.side = THREE.DoubleSide;
        m.alphaToCoverage = true;
      }
    }
  });
}

// The NPC skeletons are fitted to their own bodies; the hero's clips move the hips
// in absolute terms, so shift that track to the NPC's own rest height.
export function retargetClips(clips, heroRoot, npcRoot) {
  const hero = heroRoot.getObjectByName('hips').position;
  const npc = npcRoot.getObjectByName('hips').position;
  const delta = new THREE.Vector3().subVectors(npc, hero);
  const out = {};
  for (const [name, clip] of Object.entries(clips)) {
    const c = clip.clone();
    for (const t of c.tracks) {
      if (t.name !== 'hips.position') continue;
      for (let i = 0; i < t.values.length; i += 3) {
        t.values[i] += delta.x;
        t.values[i + 1] += delta.y;
        t.values[i + 2] += delta.z;
      }
    }
    out[name] = c;
  }
  return out;
}

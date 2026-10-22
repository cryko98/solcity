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

// rest (bind) pose of every bone: its local rotation and its rotation in model space
function restPose(root) {
  let skeleton = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton;
  });
  const bones = {};
  if (!skeleton) return bones;
  skeleton.pose();
  root.updateMatrixWorld(true);
  const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const b of skeleton.bones) {
    bones[b.name] = { local: b.quaternion.clone(), model: inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())) };
  }
  return bones;
}

// The NPC skeletons are fitted to their own bodies, so their bones' rest orientations
// (the roll of every finger joint especially) differ from the hero's. Copying the hero's
// local rotations straight across splays the fingers; instead each key is turned into
// the same rotation in model space and expressed in the NPC bone's own frame:
//   q_npc = rest_npc * Mn^-1 * Mh * (rest_hero^-1 * q_hero) * Mh^-1 * Mn
// The hips also move in absolute terms, so that track is shifted to the NPC's rest height.
export function retargetClips(clips, heroRoot, npcRoot) {
  const hero = heroRoot.getObjectByName('hips').position;
  const npc = npcRoot.getObjectByName('hips').position;
  const delta = new THREE.Vector3().subVectors(npc, hero);
  const H = restPose(heroRoot), N = restPose(npcRoot);
  const q = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const conv = {};
  for (const name of Object.keys(N)) {
    const h = H[name], n = N[name];
    if (!h) continue;
    // pre = rest_npc * Mn^-1 * Mh * rest_hero^-1, post = Mh^-1 * Mn
    const pre = n.local.clone().multiply(n.model.clone().invert()).multiply(h.model).multiply(h.local.clone().invert());
    const post = h.model.clone().invert().multiply(n.model);
    conv[name] = { pre, post };
  }
  const out = {};
  for (const [name, clip] of Object.entries(clips)) {
    const c = clip.clone();
    // bone offsets and scales are the hero's proportions (the finger joints especially): the
    // NPC keeps its own; only the hips travel
    c.tracks = c.tracks.filter((t) => t.name === 'hips.position' || t.name.endsWith('.quaternion')).map((t) => t.clone());
    for (const t of c.tracks) {
      const dot = t.name.lastIndexOf('.');
      const bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      if (t.name === 'hips.position') {
        for (let i = 0; i < t.values.length; i += 3) {
          t.values[i] += delta.x;
          t.values[i + 1] += delta.y;
          t.values[i + 2] += delta.z;
        }
      } else if (prop === 'quaternion' && conv[bone]) {
        const { pre, post } = conv[bone];
        for (let i = 0; i < t.values.length; i += 4) {
          q.fromArray(t.values, i);
          tmp.copy(pre).multiply(q).multiply(post).normalize();
          // keep neighbouring keys in the same hemisphere so interpolation stays short
          if (i >= 4 && tmp.x * t.values[i - 4] + tmp.y * t.values[i - 3] + tmp.z * t.values[i - 2] + tmp.w * t.values[i - 1] < 0) {
            tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w);
          }
          tmp.toArray(t.values, i);
        }
      }
    }
    out[name] = c;
  }
  return out;
}

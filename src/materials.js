// Fix-ups for materials exported from the Blender people models.
import * as THREE from 'three';

// hair and brow cards carry their strands in the texture alpha: cut them out, show both sides
export function prepareCharacter(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.userData.prepared) continue; // a model can be passed twice (police falls back to male)
      m.userData.prepared = true;
      if (m.name === 'HairCards' || m.name === 'BrowCards') {
        m.alphaTest = 0.45;
        m.transparent = false;
        m.side = THREE.DoubleSide;
        m.alphaToCoverage = true;
        m.envMapIntensity = 0.5;
      } else if (m.name === 'Skin') {
        // satin skin: not glossy enough to mirror the blue sky (dark skin turned purple), but
        // with enough fill that the side away from the sun stays brown instead of going black
        // (as when you step out of the hospital with the sun behind you, or under the palms)
        m.roughness = Math.max(m.roughness, 0.6);
        m.metalness = 0;
        m.envMapIntensity = 1.0;
        m.color.multiplyScalar(1.12);
        m.emissive?.setRGB(0.05, 0.026, 0.015); // warmth in the shade (blood under the skin)
      } else if (m.name === 'EyeWhite') {
        m.color.multiplyScalar(0.82); // white-hot eyes read as glowing
        m.envMapIntensity = 0.4;
      } else if (/^(Outfit_|Shoes_|Jeans|Shirt|Denim)/.test(m.name)) {
        // fabric: no plastic sheen
        m.roughness = Math.max(m.roughness, 0.82);
        m.metalness = 0;
        m.envMapIntensity = 0.6;
      }
    }
  });
}

// The street NPC models carry several MakeHuman outfits and pairs of shoes: show one of
// each. An outfit can be asked for by name (story characters); shoes go with the outfit.
const SHOES_FOR = { elegant: ['shoes01', 'shoes04'], sport: ['shoes02', 'shoes05', 'shoes06'] };
export function chooseOutfit(root, want) {
  const have = { Outfit_: [], Shoes_: [] };
  root.traverse((o) => {
    const n = o.isMesh ? o.material.name || '' : '';
    for (const p of Object.keys(have)) if (n.startsWith(p) && !n.endsWith('__shirt') && !have[p].includes(n)) have[p].push(n);
  });
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  const outfit = have.Outfit_.includes('Outfit_' + want) ? 'Outfit_' + want : any(have.Outfit_);
  const style = Object.keys(SHOES_FOR).find((k) => outfit?.includes(k));
  const fitting = have.Shoes_.filter((n) => !style || SHOES_FOR[style].some((s) => n.endsWith(s)));
  const shoes = any(fitting.length ? fitting : have.Shoes_);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name || '';
    if (n.startsWith('Outfit_')) o.visible = n === outfit || n === outfit + '__shirt';
    else if (n.startsWith('Shoes_')) o.visible = n === shoes;
  });
  coverSkin(root, outfit);
  return outfit;
}

// The skin under the outfit being worn isn't drawn: each outfit's mask ("_cov_<outfit>", 1 where
// that outfit covers the skin all round a vertex) comes with the body mesh; the skin shader drops
// the triangles inside it, so the body can't poke through the clothes when the arms move.
function coverSkin(root, outfit) {
  const attr = outfit && '_cov_' + outfit.slice(7);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !/^Skin/.test(o.material.name)) return;
    const has = attr && o.geometry.attributes[attr];
    const m = o.material; // (every body has its own skin material: its own skin colour)
    if (m.userData.cover === (has ? attr : null)) return;
    m.userData.cover = has ? attr : null;
    m.onBeforeCompile = has
      ? (sh) => {
        sh.vertexShader = `attribute float ${attr};\nvarying float vCover;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvCover = ${attr};`);
        sh.fragmentShader = 'varying float vCover;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\nif (vCover > 0.995) discard;');
      }
      : () => {};
    m.customProgramCacheKey = () => 'cover:' + (m.userData.cover || '');
    m.needsUpdate = true;
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
  const toModel = root.matrixWorld.clone().invert();
  for (const b of skeleton.bones) {
    bones[b.name] = {
      local: b.quaternion.clone(),
      model: inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())),
      pos: b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel),
      parent: b.parent?.isBone ? b.parent.name : null,
      child: b.children.find((c) => c.isBone)?.name || null,
    };
  }
  return bones;
}

// An anatomical frame for a finger bone, in model space: along the bone (y), across the palm
// from little finger to index (x), out of the palm (z). The same for every body whatever way
// its bones happen to be rolled.
function fingerFrame(B, name) {
  const s = name.slice(-1), b = B[name];
  const next = b.child ? B[b.child].pos : null;
  const along = next ? next.clone().sub(b.pos) : b.pos.clone().sub(B[b.parent].pos);
  along.normalize();
  const idx = B['index1' + s], pky = B['pinky1' + s];
  if (!idx || !pky) return null;
  const across = idx.pos.clone().sub(pky.pos);
  across.addScaledVector(along, -across.dot(along)).normalize();
  const out = new THREE.Vector3().crossVectors(across, along).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, along, out));
}

// The NPC skeletons are fitted to their own bodies, so their bones' rest orientations
// (the roll of every finger joint especially) differ from the hero's. Copying the hero's
// local rotations straight across splays the fingers; instead each key is turned into
// the same rotation in model space and expressed in the NPC bone's own frame:
//   q_npc = rest_npc * Mn^-1 * Mh * (rest_hero^-1 * q_hero) * Mh^-1 * Mn
// The hips also move in absolute terms, so that track is shifted to the NPC's rest height.
const FINGER = /^(thumb|index|middle|ring|pinky)\d[LR]$/;
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
    // fingers: the same bend in the finger's own anatomical frame. Their bones point almost
    // straight down in the rest pose, where the rig builder's bone roll is unstable (each body's
    // finger bones end up turned differently about their length), and a model-space copy curls
    // them off to the side on a hand shaped a little differently: claws instead of fists.
    //   q_npc = rest_n * Rn * Rh^-1 * rest_h^-1 * q_hero * Rh * Rn^-1,  R = M^-1 * A
    const Ah = FINGER.test(name) && fingerFrame(H, name), An = Ah && fingerFrame(N, name);
    if (Ah && An) {
      const Rh = h.model.clone().invert().multiply(Ah), Rn = n.model.clone().invert().multiply(An);
      const pre = n.local.clone().multiply(Rn).multiply(Rh.clone().invert()).multiply(h.local.clone().invert());
      const post = Rh.clone().multiply(Rn.clone().invert());
      conv[name] = { pre, post };
      continue;
    }
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

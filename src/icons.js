// Map icons: small SVG badges (a coloured disc with a white glyph), used on the minimap, the
// big map and in its legend. Each is turned into an <img> once and drawn onto the canvases.

const GLYPHS = {
  // pistol
  gun: '<path d="M6 10h13v3.2h-2.6l-.9 1.6h-3.1l-.9 4.7H8.4l1.1-4.7H6z" /><path d="M14.4 14.9h1.4l.5 1.8h-2.2z" />',
  // burger
  food: '<path d="M6 12c0-3.6 2.8-5.6 6-5.6s6 2 6 5.6z"/><rect x="5.6" y="13" width="12.8" height="1.8" rx=".9"/><path d="M6 15.8h12v1.2c0 1.2-1 2-2.2 2H8.2C7 19 6 18.2 6 17z"/>',
  // t-shirt
  clothes: '<path d="M9.2 5.5 5 7.6l1.6 3.6 1.9-.9V19h7V10.3l1.9.9L19 7.6l-4.2-2.1c-.4 1.3-1.5 2-2.8 2s-2.4-.7-2.8-2z"/>',
  // shopping bag
  mart: '<path d="M6.5 9h11l-.9 10H7.4z"/><path d="M9.3 9V7.8a2.7 2.7 0 0 1 5.4 0V9" fill="none" stroke="#fff" stroke-width="1.6"/>',
  // spray can
  spray: '<rect x="8.5" y="9" width="7" height="10.5" rx="1.4"/><rect x="10" y="6.4" width="4" height="2.4" rx=".6"/><path d="M16.5 6.4h1.2M17.6 4.6l1 .7M17.6 8.2l1-.7" stroke="#fff" stroke-width="1.1"/>',
  // chequered flag
  race: '<path d="M7 5v15" stroke="#fff" stroke-width="1.6"/><path d="M8 5.6h10v7.6H8z" fill="#fff"/><path d="M8 5.6h2.5v2.5H8zm5 0h2.5v2.5H13zM10.5 8.1H13v2.5h-2.5zm5 0H18v2.5h-2.5zM8 10.6h2.5v2.6H8zm5 0h2.5v2.6H13z" fill="#222"/>',
  // ramp with a jump arc
  stunt: '<path d="M4.5 18.5h15L4.5 12.5z"/><path d="M8 10c2.5-4.5 7.5-5 11-1.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="1.6 1.4"/><path d="m19.8 6.6-.4 3.2-3-.9z"/>',
  // bank: columns under a pediment
  bank: '<path d="M12 4.4 4.6 8.6h14.8z"/><rect x="5" y="17.4" width="14" height="1.8"/><path d="M6.6 10h1.8v6.6H6.6zm4.5 0h1.8v6.6h-1.8zm4.5 0h1.8v6.6h-1.8z"/>',
  // house (safehouse)
  house: '<path d="M12 4.6 4.4 11h2.2v8h4.2v-4.6h2.4V19h4.2v-8h2.2z"/>',
  // person (mission contact)
  contact: '<circle cx="12" cy="8.6" r="3.2"/><path d="M5.8 19.2c.5-3.8 3-5.6 6.2-5.6s5.7 1.8 6.2 5.6z"/>',
  // scissors
  barber: '<circle cx="8" cy="16.4" r="2.3" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="16" cy="16.4" r="2.3" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M9.4 14.6 16.6 5M14.6 14.6 7.4 5" stroke="#fff" stroke-width="1.6"/>',
  // a drop of ink
  tattoo: '<path d="M12 4.5c2.6 4 5 6.6 5 9.6a5 5 0 0 1-10 0c0-3 2.4-5.6 5-9.6z"/>',
  // dumbbell
  gym: '<rect x="4" y="8.5" width="3" height="7" rx=".6"/><rect x="17" y="8.5" width="3" height="7" rx=".6"/><rect x="6.5" y="10" width="2" height="4"/><rect x="15.5" y="10" width="2" height="4"/><rect x="8.5" y="11.2" width="7" height="1.6"/>',
  // cocktail glass
  club: '<path d="M5.5 6h13L12 12.6z"/><path d="M12 12.4V18M8.6 18.6h6.8" stroke="#fff" stroke-width="1.6"/>',
  // joystick
  arcade: '<rect x="5" y="14.5" width="14" height="4.5" rx="1.2"/><path d="M12 14.5V9" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="7.6" r="2.6"/>',
};

export const ICONS = {
  gun: { color: '#d63a3a', name: 'Ammu-Nation (guns)' },
  food: { color: '#f08a24', name: 'Restaurant' },
  clothes: { color: '#9b5de5', name: 'Clothes store' },
  mart: { color: '#2bb673', name: '24/7 store' },
  spray: { color: '#e0407e', name: "Pay 'n' Spray & Sol Customs" },
  race: { color: '#3a3f47', name: 'Street race' },
  stunt: { color: '#e0a81e', name: 'Stunt jump' },
  contact: { color: '#d4a514', name: 'Mission contact' },
  house: { color: '#3aa0d8', name: 'Safehouse (grey: for sale)' },
  bank: { color: '#1d2a44', name: 'Sol City Reserve (bank)' },
  barber: { color: '#2c7fb8', name: 'Barber' },
  tattoo: { color: '#7a1450', name: 'Tattoo parlour' },
  gym: { color: '#b3202a', name: 'Gym' },
  club: { color: '#9b30d9', name: 'Nightclub (dancing, darts)' },
  arcade: { color: '#1aa3c8', name: 'Arcade' },
};

export function iconSvg(key, size = 24) {
  const ic = ICONS[key];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${ic.color}" stroke="#000" stroke-width="1.6"/>` +
    `<circle cx="12" cy="12" r="9.6" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>` +
    `<g fill="#fff">${GLYPHS[key]}</g></svg>`;
}

const cache = {};
export function iconImage(key) {
  if (!ICONS[key]) return null;
  if (!cache[key]) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(key, 64));
    cache[key] = img;
  }
  return cache[key].complete ? cache[key] : null;
}
// start decoding all of them right away
for (const k of Object.keys(ICONS)) iconImage(k);

// legend for the big map: every icon with its name, plus the plain dots
export function legendHtml() {
  const dot = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
  return Object.keys(ICONS).map((k) => `<span class="ic">${iconSvg(k, 20)}${ICONS[k].name}</span>`).join('') +
    dot('#7ad65b', 'Weapon pickup') + dot('#ff5a5a', 'Health') + dot('#4b9fff', 'Armor') + '<span>M close</span>';
}

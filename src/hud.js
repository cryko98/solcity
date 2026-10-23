// HUD: minimap (rotates with the camera), money, clock, street name banner.
import { iconImage, legendHtml } from './icons.js';

const WAYPOINT_REACHED = 14; // (m)
const WAYPOINT_COLOR = '#c86bff';

// the waypoint's pin, its point at (x, y)
function pin(c, x, y, s) {
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(-s * 0.15, -s * 0.45, -s * 0.55, -s * 0.6, -s * 0.55, -s);
  c.arc(0, -s, s * 0.55, Math.PI, 0);
  c.bezierCurveTo(s * 0.55, -s * 0.6, s * 0.15, -s * 0.45, 0, 0);
  c.fillStyle = WAYPOINT_COLOR;
  c.strokeStyle = '#000';
  c.lineWidth = 2;
  c.fill();
  c.stroke();
  c.beginPath();
  c.arc(0, -s, s * 0.22, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
  c.restore();
}

// a polyline of world points through `at`, outlined
function line(c, pts, at, color, w) {
  c.beginPath();
  pts.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](...at(q)));
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(0,0,0,.6)';
  c.lineWidth = w * 1.8;
  c.stroke();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.stroke();
}

export class Hud {
  constructor(city) {
    this.city = city;
    this.mini = document.getElementById('minimap');
    this.ctx = this.mini.getContext('2d');
    this.clockEl = document.getElementById('clock');
    this.streetEl = document.getElementById('street');
    this.streetName = document.getElementById('street-name');
    this.districtName = document.getElementById('district-name');
    this.speedo = document.getElementById('speedo');
    this.kmh = document.getElementById('kmh');
    this.hint = document.getElementById('hint');
    this.hpBar = document.querySelector('#hp span');
    this.armorBar = document.querySelector('#armor span');
    this.armorWrap = document.getElementById('armor');
    this.moneyEl = document.getElementById('money');
    this.moneyAdd = document.getElementById('money-add');
    this.wastedEl = document.getElementById('wasted-screen');
    this.money = 500;
    this.lastStreet = '';
    this.streetTimer = 0;
    this.minutes = 18 * 60 + 40;
  }

  setHealth(hp) {
    this.hpBar.style.width = `${Math.max(0, hp)}%`;
    this.hpBar.classList.toggle('low', hp < 25);
  }

  setArmor(a) {
    this.armorBar.style.width = `${Math.max(0, a)}%`;
    this.armorWrap.classList.toggle('empty', a <= 0);
  }

  addMoney(amount) {
    this.money = Math.max(0, this.money + amount);
    this.moneyEl.textContent = '$' + String(this.money).padStart(8, '0');
    this.moneyAdd.textContent = amount >= 0 ? `+$${amount}` : `-$${-amount}`;
    this.moneyAdd.style.color = amount >= 0 ? '' : '#e04b3a';
    this.moneyAdd.classList.remove('show');
    void this.moneyAdd.offsetWidth; // restart the CSS animation
    this.moneyAdd.classList.add('show');
  }

  // full screen message: WASTED / BUSTED
  wasted(on, text = 'WASTED') {
    this.wastedEl.querySelector('span').textContent = text;
    this.wastedEl.classList.toggle('show', on);
  }

  // GTA-style subtitle line at the bottom of the screen
  say(text, secs = 4) {
    const el = document.getElementById('subtitle-line');
    el.innerHTML = text;
    el.classList.add('show');
    clearTimeout(this.sayTimer);
    this.sayTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }

  // mission panel (taxi): null hides it
  mission(info) {
    const el = document.getElementById('mission');
    el.classList.toggle('show', !!info);
    if (!info) return;
    const t = Math.max(0, Math.ceil(info.time ?? 0));
    el.innerHTML = `<div class="m-title">${info.title}</div>` +
      (info.time != null ? `<div class="m-row"><span>TIME</span><b class="${t <= 10 ? 'warn' : ''}">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b></div>` : '') +
      (info.rows || [
        ...(info.fare != null ? [['FARE', '$' + info.fare]] : []),
        ['FARES IN A ROW', info.streak],
      ]).map(([k, v]) => `<div class="m-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // five stars; earned ones light up and blink while the police have lost sight of you
  setWanted(level, flashing, t) {
    if (!this.starEls) {
      this.wantedEl = document.getElementById('wanted');
      this.wantedEl.innerHTML = '<span>★</span>'.repeat(5);
      this.starEls = [...this.wantedEl.children];
    }
    const blinkOff = flashing && Math.floor(t * 3) % 2 === 0;
    this.starEls.forEach((el, i) => el.classList.toggle('on', i < level && !blinkOff));
    this.wantedEl.classList.toggle('active', level > 0);
  }

  // ---------------------------------------------------------------- full-screen map (M)
  toggleMap() {
    this.mapOpen = !this.mapOpen;
    document.getElementById('bigmap').classList.toggle('show', this.mapOpen);
    // (the cursor back, to click a waypoint; the game takes the mouse again on its next click)
    if (this.mapOpen) document.exitPointerLock?.();
    if (!this.mapClicks) {
      this.mapClicks = true;
      document.querySelector('#bigmap canvas').addEventListener('click', (e) => this.mapClick(e));
    }
  }

  // ---------------------------------------------------------------- waypoint
  // click (tap) the big map: a waypoint there, and the way to it over the streets on both maps;
  // click it again to take it off. It goes by itself on arrival.
  mapClick(e) {
    const t = this.bigMapAt;
    if (!t) return;
    const r = e.target.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * e.target.width, sy = ((e.clientY - r.top) / r.height) * e.target.height;
    const x = sx / t.k - t.half, z = sy / t.k - t.half;
    const w = this.waypoint;
    if (w && Math.hypot(w.x - x, w.z - z) * t.k < Math.max(16, e.target.width / 40)) this.setWaypoint(null);
    else this.setWaypoint({ x, z });
  }

  setWaypoint(p) {
    this.waypoint = p;
    this.wpRoute = null;
    this.wpFrom = null;
  }

  // the way to the waypoint, worked out again as the player goes (p: where the player is)
  updateWaypoint(dt, p) {
    const w = this.waypoint;
    if (!w) return;
    if (Math.hypot(w.x - p.x, w.z - p.z) < WAYPOINT_REACHED) {
      this.setWaypoint(null);
      this.say('<em>Waypoint reached.</em>', 2.5);
      return;
    }
    this.wpAge = (this.wpAge || 0) + dt;
    const f = this.wpFrom;
    if (!this.wpRoute || !f || Math.hypot(f.x - p.x, f.z - p.z) > 8 || this.wpAge > 2) {
      this.wpFrom = { x: p.x, z: p.z };
      this.wpAge = 0;
      this.wpRoute = this.city.gpsRoute ? this.city.gpsRoute({ x: p.x, z: p.z }, { x: w.x, z: w.z }) : [{ x: p.x, z: p.z }, w];
    }
  }

  // every marker on the maps: the game's, then the waypoint's pin
  allBlips() {
    const list = [...(this.pickupBlips || []), ...(this.poiBlips || []), ...(this.blips || [])];
    if (this.waypoint) list.push({ ...this.waypoint, waypoint: true, edge: true });
    return list;
  }

  setMoney(v) {
    this.money = Math.max(0, Math.round(v));
    this.moneyEl.textContent = '$' + String(this.money).padStart(8, '0');
  }

  drawBigMap(p, yaw) {
    const st = document.querySelector('#bigmap .stats');
    if (st && this.stats) {
      const s = this.stats;
      st.innerHTML = [
        ['Distance driven', `${(s.km || 0).toFixed(1)} km`],
        ['Cars destroyed', s.wrecks || 0],
        ['Stunt jumps', `${s.uniqueJumps || 0} / 4`],
        ['Hidden packages', `${s.packages || 0} / 20`],
        ['Races won', s.races || 0],
        ['Taxi fares', s.fares || 0],
        ['Suspects stopped', s.suspects || 0],
        ['Most wanted', '★'.repeat(s.maxWanted || 0) || '-'],
      ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }
    const cv = document.querySelector('#bigmap canvas');
    // square, and room left under it for the legend and the hint (else the layout squashes it)
    const below = (document.querySelector('#bigmap .legend')?.offsetHeight || 0) + (this.mapHint?.offsetHeight || 0) + 40;
    const S = Math.max(160, Math.floor(Math.min(innerWidth * 0.92, innerHeight * 0.84, innerHeight - below)));
    if (cv.width !== S) {
      cv.width = cv.height = S;
      cv.style.width = cv.style.height = S + 'px';
      cv.style.flex = 'none';
    }
    const c = cv.getContext('2d');
    const { canvas } = this.city.map;
    const half = this.city.map.half ?? this.city.HALF;
    const k = S / (2 * half);
    const at = (x, z) => [(x + half) * k, (z + half) * k];
    this.bigMapAt = { k, half };
    c.drawImage(canvas, 0, 0, S, S);
    // district names
    c.font = `bold ${Math.round(S / 46)}px Anton, Impact, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const H = this.city.HALF;
    for (const [name, x, z] of [['DOWNTOWN', 0, 0], ['LITTLE HAVANA', -H * 0.6, H * 0.6], ['OLD HARBOR', -H * 0.6, -H * 0.55], ['VINEWOOD HILLS', H * 0.6, -H * 0.6], ['SOUTH BEACH', H * 0.6, H * 0.6], ['PORT OF SOL', -H * 0.8, -H * 1.12]]) {
      const [sx, sy] = at(x, z);
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0,0,0,.65)';
      c.strokeText(name, sx, sy);
      c.fillStyle = '#f6e7c4';
      c.fillText(name, sx, sy);
    }
    const atQ = (q) => at(q.x, q.z);
    if (this.wpRoute && this.wpRoute.length > 1) line(c, this.wpRoute, atQ, WAYPOINT_COLOR, Math.max(4, S / 160));
    if (this.route && this.route.length > 1) line(c, this.route, atQ, this.routeColor || '#ffd23f', Math.max(4, S / 160));
    const legend = document.querySelector('#bigmap .legend');
    if (legend && !legend.dataset.icons) {
      legend.dataset.icons = '1';
      legend.innerHTML = legendHtml();
    }
    if (!this.mapHint) {
      this.mapHint = document.createElement('div');
      this.mapHint.className = 'map-hint';
      this.mapHint.style.cssText = 'font:700 13px Inter,sans-serif;letter-spacing:1px;color:#e9d7ff;text-shadow:0 1px 3px #000;text-align:center';
      cv.parentElement.after(this.mapHint);
    }
    const hint = this.waypoint ? 'Click the pin to remove the waypoint · M close' : 'Click the map to set a waypoint · M close';
    if (this.mapHint.textContent !== hint) this.mapHint.textContent = hint;
    for (const b of this.allBlips()) {
      const [sx, sy] = at(b.x, b.z);
      if (b.waypoint) {
        pin(c, sx, sy, Math.max(16, S / 40));
        continue;
      }
      const img = b.icon && iconImage(b.icon);
      if (img) {
        const s = Math.max(22, S / 34);
        c.drawImage(img, sx - s / 2, sy - s / 2, s, s);
        if (b.label) {
          c.fillStyle = '#fff';
          c.strokeStyle = '#000';
          c.lineWidth = 3;
          c.font = 'bold ' + Math.round(s * 0.42) + 'px Arial';
          c.strokeText(b.label, sx + s * 0.45, sy - s * 0.45);
          c.fillText(b.label, sx + s * 0.45, sy - s * 0.45);
        }
        continue;
      }
      c.beginPath();
      c.arc(sx, sy, b.label ? 9 : b.r ? 4 : 8, 0, Math.PI * 2);
      c.fillStyle = b.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.fill();
      c.stroke();
      if (b.label) {
        c.fillStyle = '#111';
        c.font = 'bold 11px Arial';
        c.fillText(b.label, sx, sy + 0.5);
      }
    }
    const [px, py] = at(p.x, p.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.PI - yaw);
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 2.5;
    c.stroke();
    c.fill();
    c.restore();
  }

  setTime(h, m = 0) {
    this.minutes = h * 60 + m;
  }

  // nitro bottle under the speedometer (frac 0..1, or null when the car has none)
  setNitro(frac, on) {
    if (!this.nitroEl) {
      this.nitroEl = document.createElement('div');
      this.nitroEl.style.cssText = 'margin-top:6px;height:7px;width:110px;margin-left:auto;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.35);border-radius:4px;overflow:hidden';
      this.nitroEl.innerHTML = '<div style="height:100%;width:100%;background:linear-gradient(90deg,#2aa8ff,#9fe8ff)"></div>';
      this.speedo.appendChild(this.nitroEl);
    }
    this.nitroEl.style.display = frac === null ? 'none' : 'block';
    if (frac !== null) {
      this.nitroEl.firstChild.style.width = Math.round(frac * 100) + '%';
      this.nitroEl.firstChild.style.filter = on ? 'brightness(1.6)' : '';
    }
  }

  // p: focus position, yaw: heading of player or car, speed: car speed (m/s) or null on foot
  update(dt, p, yaw, camYaw, speed, nearCar) {
    const h = Math.floor(this.minutes / 60), m = Math.floor(this.minutes % 60);
    // 12-hour clock: 6:40 PM
    this.clockEl.innerHTML = `${h % 12 || 12}:${String(m).padStart(2, '0')}<small>${h < 12 ? 'AM' : 'PM'}</small>`;

    this.speedo.classList.toggle('show', speed !== null);
    if (speed !== null) this.kmh.textContent = Math.round(Math.abs(speed) * 3.6);
    this.hint.classList.toggle('show', !!nearCar);

    const { street, district } = this.city.locationName(p.x, p.z);
    if (street !== this.lastStreet) {
      this.lastStreet = street;
      this.streetName.textContent = street;
      this.districtName.textContent = district;
      this.streetEl.classList.add('show');
      this.streetTimer = 4;
    } else if (this.streetTimer > 0 && (this.streetTimer -= dt) <= 0) {
      this.streetEl.classList.remove('show');
    }
    this.updateWaypoint(dt, p);
    this.drawMap(p, yaw, camYaw);
    if (this.mapOpen) this.drawBigMap(p, yaw);
  }

  drawMap(p, playerYaw, camYaw) {
    const c = this.ctx, W = this.mini.width, H = this.mini.height;
    const { canvas, px } = this.city.map;
    const half = this.city.map.half ?? this.city.HALF;
    const zoom = 1.1;
    c.save();
    c.fillStyle = '#7b828a';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H * 0.62);
    c.rotate(camYaw - Math.PI);
    c.scale(zoom, zoom);
    c.drawImage(canvas, -(p.x + half) * px, -(p.z + half) * px);
    // GPS routes (world points, drawn in the same map space): the waypoint's, a mission's over it
    const atQ = (q) => [(q.x - p.x) * px, (q.z - p.z) * px];
    if (this.wpRoute && this.wpRoute.length > 1) line(c, this.wpRoute, atQ, WAYPOINT_COLOR, 5 / zoom);
    if (this.route && this.route.length > 1) line(c, this.route, atQ, this.routeColor || '#ffd23f', 5 / zoom);
    c.restore();

    // blips: stick to the minimap edge when off-screen
    const a = camYaw - Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    for (const b of this.allBlips()) {
      const dx = (b.x - p.x) * px * zoom, dz = (b.z - p.z) * px * zoom;
      let sx = dx * ca - dz * sa, sy = dx * sa + dz * ca;
      const ox = W / 2, oy = H * 0.62;
      const k = Math.min(1, (W / 2 - 10) / Math.abs(sx || 1e-6), (sy > 0 ? H - oy - 10 : oy - 10) / Math.abs(sy || 1e-6));
      sx *= k;
      sy *= k;
      if (b.waypoint) {
        pin(c, ox + sx, oy + sy + (k < 1 ? 8 : 0), 13);
        continue;
      }
      const img = b.icon && iconImage(b.icon);
      if (img) {
        if (k < 1 && !b.edge) continue; // shops etc. only when on the map
        c.drawImage(img, ox + sx - 11, oy + sy - 11, 22, 22);
        continue;
      }
      c.beginPath();
      if (b.r && k < 1) continue; // small blips only when on the map
      c.arc(ox + sx, oy + sy, b.r || 7, 0, Math.PI * 2);
      c.fillStyle = b.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.fill();
      c.stroke();
      if (b.label) {
        c.fillStyle = '#111';
        c.font = 'bold 9px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(b.label, ox + sx, oy + sy + 0.5);
      }
    }

    // player arrow
    c.save();
    c.translate(W / 2, H * 0.62);
    c.rotate(camYaw - playerYaw);
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.stroke();
    c.fill();
    c.restore();

    // north marker on the rim
    // north (world -Z, map "up") after the same rotation as the map
    const r = Math.min(W, H) * 0.42;
    const cx = W / 2 + Math.sin(a) * r, cy = H * 0.5 - Math.cos(a) * r;
    c.beginPath();
    c.arc(cx, cy, 9, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,.7)';
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 11px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', cx, cy + 0.5);
  }
}


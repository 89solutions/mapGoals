/* MapGoals – UI, map and persistence. Geometry lives in geo.js. */
(function () {
  'use strict';

  const Geo = window.MapGoalsGeo;
  const STORAGE_KEY = 'mapgoals.v1';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving';

  // ---------------------------------------------------------------- state ---
  const defaultState = () => ({
    goal: { title: '', target: null, unit: 'lbs' },
    start: null, // { lat, lng, label }
    end: null,
    routeMode: 'straight', // 'straight' | 'road'
    routePath: null, // [[lat, lng], ...] for the current start/end/mode
    routeKey: null, // identifies which start/end/mode routePath belongs to
    distUnit: 'mi',
    entries: [], // { id, date, amount, note }
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.warn('Could not load saved data', e);
    }
    return defaultState();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save data', e);
    }
  }

  // ------------------------------------------------------------------ DOM ---
  const $ = (sel) => document.querySelector(sel);
  const el = {
    title: $('#goal-title'),
    target: $('#goal-target'),
    unit: $('#goal-unit'),
    routeMode: $('#route-mode'),
    distUnit: $('#dist-unit'),
    distance: $('#distance-display'),
    routeNotice: $('#route-notice'),
    startValue: $('#start-value'),
    endValue: $('#end-value'),
    entryForm: $('#entry-form'),
    entryAmount: $('#entry-amount'),
    entryDate: $('#entry-date'),
    entryNote: $('#entry-note'),
    entries: $('#entries'),
    fill: $('#progress-fill'),
    summary: $('#summary-text'),
    banner: $('#pick-banner'),
    reset: $('#reset-btn'),
  };

  // ------------------------------------------------------------------ map ---
  const map = L.map('map', { worldCopyJump: true }).setView([30, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const icons = {
    start: L.divIcon({ className: '', html: '<div class="pin pin-start"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    end: L.divIcon({ className: '', html: '<div class="pin pin-end"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    me: L.divIcon({ className: '', html: '<div class="me">🏃</div>', iconSize: [36, 36], iconAnchor: [18, 18] }),
  };

  const layers = {
    start: null,
    end: null,
    route: L.polyline([], { color: '#5f6b7a', weight: 4, opacity: 0.7, dashArray: '8 8' }).addTo(map),
    travelled: L.polyline([], { color: '#2f6fed', weight: 6, opacity: 0.9 }).addTo(map),
    me: null,
  };

  let pickMode = null; // 'start' | 'end' | null

  map.on('click', (ev) => {
    let which = pickMode;
    if (!which) {
      if (!state.start) which = 'start';
      else if (!state.end) which = 'end';
      else return;
    }
    setPickMode(null);
    setPoint(which, { lat: ev.latlng.lat, lng: wrapLng(ev.latlng.lng), label: null });
  });

  function setPickMode(which) {
    pickMode = which;
    document.querySelectorAll('.pick-btn').forEach((b) => b.classList.toggle('active', b.dataset.which === which));
    map.getContainer().classList.toggle('picking', !!which);
    el.banner.hidden = !which;
    if (which) el.banner.textContent = `Click the map to set your ${which === 'start' ? 'start point' : 'destination'} (Esc to cancel)`;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setPickMode(null);
  });

  function wrapLng(lng) {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
  }

  function makeMarker(which) {
    const m = L.marker([0, 0], { icon: icons[which], draggable: true, keyboard: true, title: which === 'start' ? 'Start' : 'Destination' });
    m.on('dragend', () => {
      const ll = m.getLatLng();
      setPoint(which, { lat: ll.lat, lng: wrapLng(ll.lng), label: null });
    });
    return m.addTo(map);
  }

  // --------------------------------------------------------------- points ---
  function setPoint(which, point) {
    state[which] = point;
    save();
    renderPoints();
    updateRoute({ fit: true });
    if (!point.label) {
      reverseGeocode(point.lat, point.lng).then((name) => {
        // Only apply if the point hasn't changed meanwhile.
        if (name && state[which] && state[which].lat === point.lat && state[which].lng === point.lng) {
          state[which].label = name;
          save();
          renderPoints();
        }
      });
    }
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  }

  function renderPoints() {
    for (const which of ['start', 'end']) {
      const p = state[which];
      const valueEl = which === 'start' ? el.startValue : el.endValue;
      valueEl.textContent = p ? (p.label || fmtCoord(p)) : 'Not set';
      if (p) {
        if (!layers[which]) layers[which] = makeMarker(which);
        layers[which].setLatLng([p.lat, p.lng]);
        layers[which].bindTooltip(p.label || fmtCoord(p));
      } else if (layers[which]) {
        map.removeLayer(layers[which]);
        layers[which] = null;
      }
    }
  }

  // ---------------------------------------------------------------- route ---
  let routeRequest = 0;

  function currentRouteKey() {
    if (!state.start || !state.end) return null;
    return [state.start.lat, state.start.lng, state.end.lat, state.end.lng, state.routeMode].join('|');
  }

  async function updateRoute({ fit = false } = {}) {
    const key = currentRouteKey();
    el.routeNotice.hidden = true;

    if (!key) {
      state.routePath = null;
      state.routeKey = null;
      save();
      renderRouteAndProgress();
      return;
    }

    if (state.routeKey !== key || !state.routePath) {
      const reqId = ++routeRequest;
      const a = [state.start.lat, state.start.lng];
      const b = [state.end.lat, state.end.lng];
      let path = null;

      if (state.routeMode === 'road') {
        el.distance.textContent = 'Distance: calculating road route…';
        try {
          path = await fetchRoadRoute(a, b);
        } catch (err) {
          console.warn('Road routing failed', err);
          showRouteNotice('Couldn’t find a road route between these points (or the routing service is unavailable), so a straight line is shown instead.');
        }
        if (reqId !== routeRequest) return; // a newer request superseded this one
      }
      if (!path) path = Geo.greatCirclePoints(a, b);

      state.routePath = path;
      state.routeKey = key;
      save();
    }

    renderRouteAndProgress();
    if (fit && state.routePath) {
      map.fitBounds(L.latLngBounds(state.routePath), { padding: [40, 40], maxZoom: 12 });
    }
  }

  async function fetchRoadRoute(a, b) {
    const url = `${OSRM}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error(data.code || 'No route');
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. Anchor the ends on the chosen points.
    const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    return [a, ...coords, b];
  }

  function showRouteNotice(msg) {
    el.routeNotice.textContent = msg;
    el.routeNotice.hidden = false;
  }

  // ------------------------------------------------------------- progress ---
  function fmtNum(n, dp = 1) {
    const r = Math.round(n * 10 ** dp) / 10 ** dp;
    return r.toLocaleString(undefined, { maximumFractionDigits: dp });
  }

  function renderRouteAndProgress() {
    const path = state.routePath;
    const unit = state.distUnit;
    const unitName = unit === 'mi' ? 'miles' : 'km';
    const goalUnit = state.goal.unit || '';
    const target = Number(state.goal.target);
    const achieved = Geo.totalProgress(state.entries);
    const fraction = Geo.progressFraction(achieved, target);

    document.querySelectorAll('.unit-label').forEach((s) => (s.textContent = goalUnit || 'units'));

    // Route line
    layers.route.setLatLngs(path || []);

    let totalDist = 0;
    if (path) {
      totalDist = Geo.kmTo(Geo.pathLengthKm(path), unit);
      el.distance.textContent = `Distance: ${fmtNum(totalDist)} ${unitName}`;
    } else {
      el.distance.textContent = 'Distance: –';
    }

    // Progress bar
    el.fill.style.width = `${(fraction * 100).toFixed(1)}%`;

    // Current position
    if (path) {
      const pos = Geo.pointAlongPath(path, fraction);
      layers.travelled.setLatLngs(pos.travelled);
      if (!layers.me) layers.me = L.marker(pos.point, { icon: icons.me, zIndexOffset: 1000, keyboard: false }).addTo(map);
      layers.me.setLatLng(pos.point);
      const travelled = totalDist * fraction;
      layers.me.bindPopup(
        `<strong>${escapeHtml(state.goal.title || 'Your goal')}</strong><br>` +
          `${fmtNum(achieved)} of ${fmtNum(target || 0)} ${escapeHtml(goalUnit)} (${fmtNum(fraction * 100, 0)}%)<br>` +
          `${fmtNum(travelled)} ${unitName} travelled, ${fmtNum(totalDist - travelled)} to go`
      );
      updateNearby(pos.point);
    } else {
      layers.travelled.setLatLngs([]);
      if (layers.me) {
        map.removeLayer(layers.me);
        layers.me = null;
      }
    }

    renderSummary({ achieved, target, fraction, totalDist, unitName, goalUnit, hasRoute: !!path });
    renderEntries(goalUnit);
  }

  let nearbyName = null;
  let nearbyTimer = null;
  let nearbyFor = null;

  function updateNearby(point) {
    const key = point.map((v) => v.toFixed(2)).join(',');
    if (key === nearbyFor) return;
    nearbyFor = key;
    nearbyName = null;
    clearTimeout(nearbyTimer);
    nearbyTimer = setTimeout(async () => {
      const name = await reverseGeocode(point[0], wrapLng(point[1]), 10);
      if (nearbyFor === key && name) {
        nearbyName = name;
        renderRouteAndProgress();
      }
    }, 600);
  }

  function renderSummary({ achieved, target, fraction, totalDist, unitName, goalUnit, hasRoute }) {
    const parts = [];
    const s = el.summary;
    s.textContent = '';

    if (!(target > 0)) {
      s.textContent = 'Enter a target amount for your goal to get started.';
      return;
    }

    const line1 = document.createElement('div');
    line1.innerHTML = `<strong>${fmtNum(achieved)}</strong> of <strong>${fmtNum(target)}</strong> ${escapeHtml(goalUnit)} &mdash; <strong>${fmtNum(fraction * 100, 0)}%</strong>`;
    parts.push(line1);

    if (hasRoute) {
      const travelled = totalDist * fraction;
      const line2 = document.createElement('div');
      line2.textContent = `${fmtNum(travelled)} of ${fmtNum(totalDist)} ${unitName} travelled, ${fmtNum(totalDist - travelled)} ${unitName} to go.`;
      parts.push(line2);
      if (nearbyName && fraction > 0 && fraction < 1) {
        const line3 = document.createElement('div');
        line3.textContent = `📍 You're currently near ${nearbyName}.`;
        parts.push(line3);
      }
    } else {
      const line2 = document.createElement('div');
      line2.textContent = 'Choose a start point and destination to see your journey.';
      parts.push(line2);
    }

    if (fraction >= 1) {
      const done = document.createElement('div');
      done.className = 'done';
      done.textContent = `🎉 Goal reached! You've arrived${state.end && state.end.label ? ' at ' + state.end.label.split(',')[0] : ''}!`;
      parts.push(done);
    } else if (achieved > 0) {
      const left = document.createElement('div');
      left.textContent = `${fmtNum(target - achieved)} ${goalUnit} left to go. Keep it up!`;
      parts.push(left);
    }

    parts.forEach((p) => s.appendChild(p));
  }

  function renderEntries(goalUnit) {
    el.entries.textContent = '';
    const sorted = [...state.entries].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
    for (const entry of sorted) {
      const li = document.createElement('li');
      const amt = document.createElement('span');
      const amount = Number(entry.amount);
      amt.className = 'amt' + (amount < 0 ? ' neg' : '');
      amt.textContent = `${amount > 0 ? '+' : ''}${fmtNum(amount, 2)} ${goalUnit}`;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatDate(entry.date) + (entry.note ? ` · ${entry.note}` : '');
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Delete entry';
      del.setAttribute('aria-label', 'Delete entry');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        state.entries = state.entries.filter((e) => e.id !== entry.id);
        save();
        renderRouteAndProgress();
      });
      li.append(amt, meta, del);
      el.entries.appendChild(li);
    }
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------ geocoding ---
  const reverseCache = new Map();

  async function reverseGeocode(lat, lng, zoom = 14) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${zoom}`;
    if (reverseCache.has(key)) return reverseCache.get(key);
    try {
      const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.address || {};
      const name =
        [a.city || a.town || a.village || a.hamlet || a.county || a.state, a.country].filter(Boolean).join(', ') ||
        data.display_name ||
        null;
      reverseCache.set(key, name);
      return name;
    } catch (e) {
      return null;
    }
  }

  async function searchPlaces(query) {
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  document.querySelectorAll('.search-form').forEach((form) => {
    const which = form.dataset.which;
    const list = document.querySelector(`.search-results[data-which="${which}"]`);
    const input = form.querySelector('input');

    const message = (text) => {
      list.textContent = '';
      const li = document.createElement('li');
      li.className = 'msg';
      li.textContent = text;
      list.appendChild(li);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      message('Searching…');
      try {
        const results = await searchPlaces(q);
        list.textContent = '';
        if (!results.length) return message('No places found. Try another search, or pick on the map.');
        for (const r of results) {
          const li = document.createElement('li');
          li.textContent = r.display_name;
          li.tabIndex = 0;
          const choose = () => {
            list.textContent = '';
            input.value = '';
            setPoint(which, { lat: Number(r.lat), lng: Number(r.lon), label: r.display_name });
          };
          li.addEventListener('click', choose);
          li.addEventListener('keydown', (ev) => ev.key === 'Enter' && choose());
          list.appendChild(li);
        }
      } catch (err) {
        message('Search is unavailable right now — use “Pick on map” instead.');
      }
    });
  });

  document.querySelectorAll('.pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPickMode(pickMode === btn.dataset.which ? null : btn.dataset.which));
  });

  // ------------------------------------------------------------- controls ---
  function bindGoalInputs() {
    el.title.value = state.goal.title || '';
    el.target.value = state.goal.target ?? '';
    el.unit.value = state.goal.unit || '';
    el.routeMode.value = state.routeMode;
    el.distUnit.value = state.distUnit;
    el.entryDate.value = today();

    el.title.addEventListener('input', () => {
      state.goal.title = el.title.value;
      save();
      renderRouteAndProgress();
    });
    el.target.addEventListener('input', () => {
      const v = parseFloat(el.target.value);
      state.goal.target = isFinite(v) ? v : null;
      save();
      renderRouteAndProgress();
    });
    el.unit.addEventListener('input', () => {
      state.goal.unit = el.unit.value.trim();
      save();
      renderRouteAndProgress();
    });
    el.routeMode.addEventListener('change', () => {
      state.routeMode = el.routeMode.value;
      save();
      updateRoute({ fit: true });
    });
    el.distUnit.addEventListener('change', () => {
      state.distUnit = el.distUnit.value;
      save();
      renderRouteAndProgress();
    });

    el.entryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = parseFloat(el.entryAmount.value);
      if (!isFinite(amount) || amount === 0) {
        el.entryAmount.focus();
        return;
      }
      state.entries.push({
        id: Date.now(),
        date: el.entryDate.value || today(),
        amount,
        note: el.entryNote.value.trim(),
      });
      save();
      el.entryAmount.value = '';
      el.entryNote.value = '';
      renderRouteAndProgress();
      if (layers.me) layers.me.openPopup();
    });

    el.reset.addEventListener('click', () => {
      if (!confirm('Delete your goal, route and all logged progress?')) return;
      state = defaultState();
      save();
      location.reload();
    });
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ----------------------------------------------------------------- init ---
  bindGoalInputs();
  renderPoints();
  updateRoute({ fit: true });

  // Exposed for debugging / tests.
  window.MapGoalsApp = { getState: () => state, setPoint };
})();

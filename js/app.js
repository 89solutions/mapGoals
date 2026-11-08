/* MapGoals – UI, map and persistence. Geometry lives in geo.js. */
(function () {
  'use strict';

  const Geo = window.MapGoalsGeo;
  const Units = window.MapGoalsUnits;
  const Forecast = window.MapGoalsForecast;
  const STORAGE_KEY = 'mapgoals.v1';
  const RATES_KEY = 'mapgoals.rates';
  const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving';
  const RATES_URL = 'https://api.frankfurter.app/latest?from=EUR';

  // ---------------------------------------------------------------- state ---
  const defaultState = () => ({
    // target is a number expressed in `unit`; targetText is what the user typed.
    // startDate: when the goal began (used for the average rate); targetDate: optional "finish by".
    goal: { title: '', target: null, targetText: '', unit: 'lb', customUnit: '', startDate: today(), targetDate: '' },
    start: null, // { lat, lng, label }
    end: null,
    routeMode: 'straight', // 'straight' | 'road'
    routePath: null, // [[lat, lng], ...] for the current start/end/mode
    routeKey: null, // identifies which start/end/mode routePath belongs to
    distUnit: 'mi',
    entries: [], // { id, date, amount, unit, note } – amount is in the entry's own unit
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return migrate(Object.assign(defaultState(), JSON.parse(raw)));
    } catch (e) {
      console.warn('Could not load saved data', e);
    }
    return defaultState();
  }

  /** Upgrade data saved before units were structured (free-text unit, unit-less entries). */
  function migrate(s) {
    s.goal = Object.assign(defaultState().goal, { startDate: '' }, s.goal);
    if (!Units.UNITS[s.goal.unit]) {
      const id = Units.unitIdFromText(s.goal.unit);
      if (id) s.goal.unit = id;
      else {
        s.goal.customUnit = s.goal.customUnit || s.goal.unit || '';
        s.goal.unit = 'custom';
      }
    }
    if (!s.goal.targetText && s.goal.target != null) s.goal.targetText = String(s.goal.target);
    s.entries = (s.entries || []).map((e) => (e.unit ? e : Object.assign({}, e, { unit: s.goal.unit })));
    return s;
  }

  // ---------------------------------------------------------------- rates ---
  let rates = { rates: Units.FALLBACK_RATES, date: null, live: false };
  try {
    const cached = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
    if (cached && cached.rates) rates = cached;
  } catch (e) {
    /* ignore */
  }

  function usesCurrency() {
    return (
      Units.categoryOf(state.goal.unit) === 'currency' ||
      state.entries.some((e) => Units.categoryOf(e.unit) === 'currency')
    );
  }

  /** Fetch live exchange rates (ECB, via Frankfurter) when money is involved; cache for 12h. */
  async function ensureRates() {
    if (!usesCurrency()) return;
    if (rates.live && Date.now() - (rates.fetchedAt || 0) < RATES_MAX_AGE_MS) return;
    try {
      const res = await fetch(RATES_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = Object.assign({ EUR: 1 }, data.rates);
      const merged = Object.assign({}, Units.FALLBACK_RATES, r);
      rates = { rates: merged, date: data.date, live: true, fetchedAt: Date.now() };
      localStorage.setItem(RATES_KEY, JSON.stringify(rates));
      renderRouteAndProgress();
    } catch (e) {
      console.warn('Could not fetch exchange rates; using cached/approximate rates', e);
    }
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
    customUnit: $('#goal-custom-unit'),
    customUnitWrap: $('#custom-unit-wrap'),
    targetError: $('#target-error'),
    entryUnit: $('#entry-unit'),
    entryError: $('#entry-error'),
    ratesNote: $('#rates-note'),
    startDate: $('#goal-start-date'),
    targetDate: $('#goal-target-date'),
    forecast: $('#forecast'),
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
    const target = Number(state.goal.target);
    const { total: achieved, skipped } = Units.sumInUnit(state.entries, state.goal.unit, rates.rates);
    const fraction = Geo.progressFraction(achieved, target);
    const forecast = computeForecast(target);

    renderRatesNote();

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
          `${escapeHtml(fmtGoal(achieved))} of ${escapeHtml(fmtGoal(target || 0))} (${fmtNum(fraction * 100, 0)}%)<br>` +
          `${fmtNum(travelled)} ${unitName} travelled, ${fmtNum(totalDist - travelled)} to go` +
          (forecast.status === 'estimate' ? `<br>📅 Est. finish: ${escapeHtml(formatLongDate(forecast.finishDate))}` : '') +
          (forecast.status === 'reached' ? `<br>🏁 Reached on ${escapeHtml(formatLongDate(forecast.reachedDate))}` : '')
      );
      updateNearby(pos.point);
    } else {
      layers.travelled.setLatLngs([]);
      if (layers.me) {
        map.removeLayer(layers.me);
        layers.me = null;
      }
    }

    renderSummary({ achieved, target, fraction, totalDist, unitName, skipped, hasRoute: !!path });
    renderForecast(forecast);
    renderEntries();
  }

  // ------------------------------------------------------------- forecast ---

  /** Estimate the finish date from the average rate of progress to date. */
  function computeForecast(target) {
    const goalUnit = state.goal.unit;
    const list = [];
    for (const e of state.entries) {
      const v = Units.convert(Number(e.amount) || 0, e.unit || goalUnit, goalUnit, rates.rates);
      if (v !== null) list.push({ date: e.date, value: v });
    }
    return Forecast.estimateFinish(list, target, {
      startDate: state.goal.startDate,
      targetDate: state.goal.targetDate,
    });
  }

  function renderForecast(f) {
    const box = el.forecast;
    box.textContent = '';
    box.className = 'forecast';
    box.hidden = f.status === 'no-target';
    if (box.hidden) return;

    const line = (text, cls) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      d.textContent = text;
      box.appendChild(d);
      return d;
    };
    const perWeek = (ratePerDay) => `${fmtGoal(ratePerDay * 7)} a week`;
    const fromTo = (f) =>
      f.basisFrom === f.basisTo ? '' : ` from ${formatDate(f.basisFrom)} to ${formatDate(f.basisTo)}`;

    switch (f.status) {
      case 'no-data':
        line('📅 Log your first progress to get an estimated finish date.');
        break;
      case 'need-more':
        line(
          state.goal.startDate
            ? '📅 Log progress on another day to get an estimated finish date.'
            : '📅 Log progress on another day, or set a start date, to get an estimated finish date.'
        );
        break;
      case 'no-progress':
        line(`📅 No estimated finish date yet: overall progress${fromTo(f)} is flat or going the wrong way.`);
        break;
      case 'too-slow':
        line(`📅 At your current average of ${perWeek(f.ratePerDay)}, this would take over 100 years.`);
        break;
      case 'estimate': {
        const daysAway = Forecast.daysBetween(today(), f.finishDate);
        const when = daysAway < 0 ? 'this date has passed – log your latest progress to update it' : Forecast.describeIn(daysAway);
        line(`📅 Estimated finish: ${formatLongDate(f.finishDate)} (${when})`, 'eta');
        line(`Based on your average of ${perWeek(f.ratePerDay)}${fromTo(f)}. This updates each time you log progress.`, 'basis');
        break;
      }
      case 'reached': {
        box.classList.add('done');
        const took = state.goal.startDate ? Forecast.daysBetween(state.goal.startDate, f.reachedDate) : null;
        line(
          `🏁 Goal reached on ${formatLongDate(f.reachedDate)}` + (took > 0 ? ` – it took ${Forecast.describeSpan(took)}.` : '.'),
          'eta'
        );
        if (f.targetDate || state.goal.targetDate) {
          const diff = Forecast.daysBetween(state.goal.targetDate, f.reachedDate);
          if (diff !== null) {
            if (diff <= 0) line(`✅ ${diff === 0 ? 'Right on' : Forecast.describeSpan(diff) + ' ahead of'} your finish-by date.`, 'ahead');
            else line(`Finished ${Forecast.describeSpan(diff)} after your finish-by date – but you made it!`, 'basis');
          }
        }
        return;
      }
    }

    // Finish-by date comparison.
    if (!f.targetDate) return;
    const by = formatLongDate(f.targetDate);
    if (f.status === 'estimate') {
      if (f.daysLate <= 0) {
        line(f.daysLate === 0 ? `✅ Right on schedule for ${by}.` : `✅ On track – about ${Forecast.describeSpan(f.daysLate)} ahead of ${by}.`, 'ahead');
        return;
      }
      line(`⚠️ About ${Forecast.describeSpan(f.daysLate)} behind your finish-by date of ${by}.`, 'behind');
    }
    if (f.requiredRatePerDay === null) line(`Your finish-by date of ${by} has passed.`, 'basis');
    else if (f.requiredRatePerDay !== undefined && f.status !== 'no-data')
      line(`To finish by ${by} you need ${perWeek(f.requiredRatePerDay)}.`, 'basis');
  }

  function formatLongDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Format an amount in the goal's unit, e.g. "£3.52" or "10 st 4 lb". */
  function fmtGoal(value, opts) {
    return Units.format(value, state.goal.unit, state.goal.customUnit, opts);
  }

  function renderRatesNote() {
    if (!usesCurrency()) {
      el.ratesNote.hidden = true;
      return;
    }
    el.ratesNote.hidden = false;
    el.ratesNote.textContent = rates.live
      ? `💱 Different currencies are converted using European Central Bank rates from ${formatDate(rates.date)}.`
      : '💱 Live exchange rates are unavailable, so approximate rates are used for converting between currencies.';
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

  function renderSummary({ achieved, target, fraction, totalDist, unitName, skipped, hasRoute }) {
    const parts = [];
    const s = el.summary;
    s.textContent = '';

    if (!(target > 0)) {
      s.textContent = 'Enter a target amount for your goal to get started.';
      return;
    }

    const line1 = document.createElement('div');
    line1.innerHTML = `<strong>${escapeHtml(fmtGoal(achieved))}</strong> of <strong>${escapeHtml(fmtGoal(target))}</strong> &mdash; <strong>${fmtNum(fraction * 100, 0)}%</strong>`;
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
      left.textContent = `${fmtGoal(target - achieved)} left to go. Keep it up!`;
      parts.push(left);
    }

    if (skipped.length) {
      const warn = document.createElement('div');
      warn.className = 'field-error';
      warn.textContent = `⚠️ ${skipped.length} entr${skipped.length === 1 ? 'y is' : 'ies are'} in a unit that can't be converted to ${Units.getUnit(state.goal.unit).label.replace(/…$/, '')} and ${skipped.length === 1 ? "isn't" : "aren't"} counted.`;
      parts.push(warn);
    }

    parts.forEach((p) => s.appendChild(p));
  }

  function renderEntries() {
    el.entries.textContent = '';
    const goalUnit = state.goal.unit;
    const custom = state.goal.customUnit;
    const sorted = [...state.entries].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
    for (const entry of sorted) {
      const li = document.createElement('li');
      const amt = document.createElement('span');
      const amount = Number(entry.amount);
      const unit = entry.unit || goalUnit;
      amt.className = 'amt' + (amount < 0 ? ' neg' : '');
      amt.textContent = Units.format(amount, unit, custom, { signed: true });
      if (unit !== goalUnit) {
        const converted = Units.convert(amount, unit, goalUnit, rates.rates);
        const conv = document.createElement('span');
        conv.className = 'conv';
        if (converted === null) {
          conv.textContent = 'not counted';
          li.classList.add('incompatible');
        } else {
          conv.textContent = `≈ ${fmtGoal(converted, { signed: true })}`;
        }
        amt.appendChild(conv);
      }
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
  /** Fill a <select> with unit options, grouped by category. */
  function fillUnitSelect(select, unitIds, selected) {
    select.textContent = '';
    for (const cat of Units.CATEGORIES) {
      const ids = unitIds.filter((id) => Units.categoryOf(id) === cat.id);
      if (!ids.length) continue;
      const group = document.createElement('optgroup');
      group.label = cat.label;
      for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id === 'custom' && state.goal.customUnit && select === el.entryUnit
          ? state.goal.customUnit
          : Units.UNITS[id].label;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
    select.value = selected;
  }

  /** Refresh controls that depend on the goal's unit. */
  function syncUnitControls() {
    const unit = state.goal.unit;
    el.customUnitWrap.hidden = unit !== 'custom';
    const compatible = Units.compatibleUnits(unit);
    const keep = compatible.includes(el.entryUnit.value) ? el.entryUnit.value : unit;
    fillUnitSelect(el.entryUnit, compatible, keep);
    el.entryUnit.disabled = compatible.length < 2;
    el.entryAmount.placeholder = Units.categoryOf(unit) === 'currency' ? 'e.g. 3.52' : 'e.g. 2.5';
    el.target.placeholder = Units.categoryOf(unit) === 'currency' ? 'e.g. 500' : 'e.g. 30';
  }

  function showError(node, msg) {
    node.textContent = msg || '';
    node.hidden = !msg;
  }

  /** Parse the target box; it may be typed in another compatible unit ("2st" for a lbs goal). */
  function applyTarget() {
    const text = el.target.value.trim();
    state.goal.targetText = text;
    if (!text) {
      state.goal.target = null;
      showError(el.targetError, '');
    } else {
      const r = Units.parseAmount(text, state.goal.unit, state.goal.customUnit);
      const v = r.error ? null : Units.convert(r.value, r.unit, state.goal.unit, rates.rates);
      if (r.error || v === null) {
        state.goal.target = null;
        showError(el.targetError, r.error || `That unit can't be converted to ${Units.getUnit(state.goal.unit).label}.`);
      } else if (v <= 0) {
        state.goal.target = null;
        showError(el.targetError, 'The target needs to be more than zero.');
      } else {
        state.goal.target = v;
        showError(el.targetError, '');
      }
    }
    save();
    renderRouteAndProgress();
  }

  function bindGoalInputs() {
    fillUnitSelect(el.unit, Object.keys(Units.UNITS), state.goal.unit);
    el.title.value = state.goal.title || '';
    el.startDate.value = state.goal.startDate || '';
    el.targetDate.value = state.goal.targetDate || '';
    for (const [input, key] of [[el.startDate, 'startDate'], [el.targetDate, 'targetDate']]) {
      input.addEventListener('change', () => {
        state.goal[key] = input.value;
        save();
        renderRouteAndProgress();
      });
    }
    el.target.value = state.goal.targetText || '';
    el.customUnit.value = state.goal.customUnit || '';
    el.routeMode.value = state.routeMode;
    el.distUnit.value = state.distUnit;
    el.entryDate.value = today();
    syncUnitControls();

    el.title.addEventListener('input', () => {
      state.goal.title = el.title.value;
      save();
      renderRouteAndProgress();
    });
    el.target.addEventListener('input', applyTarget);

    el.unit.addEventListener('change', () => {
      const from = state.goal.unit;
      const to = el.unit.value;
      // Keep the same target when switching between compatible units (30 lbs → 13.61 kg).
      if (state.goal.target != null) {
        const v = Units.convert(state.goal.target, from, to, rates.rates);
        if (v !== null && from !== to) {
          const d = Units.getUnit(to).decimals;
          // Stones are shown as "2 st 2 lb", which parses back exactly.
          state.goal.targetText = to === 'st' ? Units.format(v, 'st') : String(Math.round(v * 10 ** d) / 10 ** d);
          el.target.value = state.goal.targetText;
        }
      }
      state.goal.unit = to;
      el.entryUnit.value = to;
      syncUnitControls();
      applyTarget();
      ensureRates();
    });

    el.customUnit.addEventListener('input', () => {
      state.goal.customUnit = el.customUnit.value.trim();
      syncUnitControls();
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

    el.entryAmount.addEventListener('input', () => showError(el.entryError, ''));
    el.entryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // A unit typed in the box ("£3.52", "52p", "1.2kg") wins over the dropdown.
      const r = Units.parseAmount(el.entryAmount.value, el.entryUnit.value, state.goal.customUnit);
      if (r.error) {
        showError(el.entryError, r.error);
        el.entryAmount.focus();
        return;
      }
      if (r.value === 0) {
        showError(el.entryError, 'Please enter an amount other than zero.');
        el.entryAmount.focus();
        return;
      }
      if (Units.convert(1, r.unit, state.goal.unit, Units.FALLBACK_RATES) === null) {
        showError(el.entryError, `${Units.getUnit(r.unit).label} can't be converted to ${Units.getUnit(state.goal.unit).label}.`);
        el.entryAmount.focus();
        return;
      }
      showError(el.entryError, '');
      state.entries.push({
        id: Date.now(),
        date: el.entryDate.value || today(),
        amount: r.value,
        unit: r.unit,
        note: el.entryNote.value.trim(),
      });
      save();
      el.entryAmount.value = '';
      el.entryNote.value = '';
      renderRouteAndProgress();
      ensureRates();
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
  ensureRates();

  // Exposed for debugging / tests.
  window.MapGoalsApp = { getState: () => state, setPoint };
})();

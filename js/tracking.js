/**
 * tracking.js – GPS tracking, route recording, closure detection
 */
const Tracker = (() => {

  const CLOSURE_THRESHOLD_M  = 25;   // metres – how close to start triggers closure
  const CLOSURE_MIN_POINTS   = 20;   // minimum GPS points before closure is allowed
  const MAX_ACCURACY_M       = 35;   // skip fixes worse than this
  const MIN_DISTANCE_M       = 3;    // skip points closer than this (noise filter)

  let watchId       = null;
  let points        = [];   // { lat, lng, ts }
  let totalDistance = 0;    // metres
  let startTime     = null;
  let timerInterval = null;
  let lastPoint     = null;
  let isRunning     = false;

  // ---- Distance helpers ----
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---- Format helpers ----
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  // ---- Start tracking ----
  function start() {
    if (isRunning) return;
    isRunning     = true;
    points        = [];
    totalDistance = 0;
    startTime     = Date.now();
    lastPoint     = null;

    // Show stats bar
    document.getElementById('stats-bar').classList.remove('hidden');

    // Timer UI update
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      document.getElementById('stat-time').textContent = formatTime(elapsed);
    }, 1000);

    // GPS watch
    if (!('geolocation' in navigator)) {
      App.showToast('GPS недоступен на этом устройстве', 'error');
      stop();
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      onPosition,
      onError,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // ---- Stop tracking (manual or auto-close) ----
  function stop(autoClose = false) {
    if (!isRunning) return;
    isRunning = false;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    clearInterval(timerInterval);

    document.getElementById('closure-hint').classList.add('hidden');

    const duration = Math.floor((Date.now() - startTime) / 1000);

    return { points, totalDistance, duration, startTime };
  }

  // ---- On GPS fix ----
  function onPosition(pos) {
    const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;

    // Filter bad accuracy
    if (accuracy > MAX_ACCURACY_M) return;

    // Filter noise
    if (lastPoint) {
      const d = haversine(lastPoint.lat, lastPoint.lng, lat, lng);
      if (d < MIN_DISTANCE_M) return;
      totalDistance += d;
    }

    const point = { lat, lng, ts: Date.now() };
    points.push(point);
    lastPoint = point;

    // Update map route
    MapManager.addRoutePoint(lat, lng);
    MapManager.updateUserMarker(lat, lng);

    // Update speed
    const speedKmh = speed != null && speed >= 0 ? (speed * 3.6).toFixed(1) : calcSpeed(lat, lng);
    document.getElementById('stat-speed').textContent = speedKmh;

    // Update distance
    document.getElementById('stat-distance').textContent = (totalDistance / 1000).toFixed(2);

    // Check closure
    if (points.length >= CLOSURE_MIN_POINTS) {
      const dist = TerritoryManager.distanceToStart(lat, lng, points[0].lat, points[0].lng);
      const hint = document.getElementById('closure-hint');
      if (dist < CLOSURE_THRESHOLD_M) {
        hint.classList.remove('hidden');
        hint.onclick = () => App.closureConfirm();
      } else {
        hint.classList.add('hidden');
      }
    }
  }

  // Fallback speed from last two points
  let _lastSpeedPoint = null;
  function calcSpeed(lat, lng) {
    const now = Date.now();
    if (_lastSpeedPoint) {
      const d = haversine(_lastSpeedPoint.lat, _lastSpeedPoint.lng, lat, lng);
      const dt = (now - _lastSpeedPoint.ts) / 1000;
      if (dt > 0) {
        _lastSpeedPoint = { lat, lng, ts: now };
        return ((d / dt) * 3.6).toFixed(1);
      }
    }
    _lastSpeedPoint = { lat, lng, ts: now };
    return '0.0';
  }

  function onError(err) {
    console.warn('GPS error:', err.message);
    if (err.code === 1) {
      App.showToast('Разрешите доступ к геолокации', 'error');
      App.stopTracking(false);
    }
  }

  function getPoints() { return points; }
  function getDistance() { return totalDistance; }
  function getDuration() { return startTime ? Math.floor((Date.now() - startTime) / 1000) : 0; }
  function getIsRunning() { return isRunning; }

  return { start, stop, getPoints, getDistance, getDuration, getIsRunning };
})();

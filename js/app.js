/**
 * app.js – Application entry point
 * Initialises Telegram WebApp, manages state, tab routing
 */
const App = (() => {

  // ---- Telegram WebApp ----
  const tg = window.Telegram?.WebApp;
  let currentTab   = 'map';
  let isTracking   = false;
  let toastTimer   = null;

  // ---- Init ----
  function init() {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#0f0f14');
      tg.setBackgroundColor('#0f0f14');
    }

    // Load or create user
    ensureUser();

    // Request GPS & init map
    requestLocationAndInit();

    // Render profile tab
    renderProfile();

    // Color picker
    document.querySelectorAll('.color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const user = Storage.getUser();
        user.color = btn.dataset.color;
        Storage.saveUser(user);
        // Update avatar ring
        document.querySelector('.profile-avatar-ring').style.borderColor = user.color;
        showToast('Цвет территории обновлён');
        // Re-render own territories with new color
        updateOwnTerritoryColor(user.color);
      });
    });
  }

  // ---- User setup ----
  function ensureUser() {
    let user = Storage.getUser();
    if (!user) {
      const tgUser = tg?.initDataUnsafe?.user;
      user = {
        id:       tgUser?.id ? String(tgUser.id) : 'user_' + Date.now(),
        username: tgUser?.first_name || tgUser?.username || 'Игрок',
        avatar:   tgUser?.photo_url  || null,
        color:    '#6c63ff',
      };
      // Fallback avatar via UI Avatars
      if (!user.avatar) {
        user.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username[0])}&background=6c63ff&color=fff&size=128`;
      }
      Storage.saveUser(user);
    }
    return user;
  }

  // ---- GPS + Map init ----
  function requestLocationAndInit() {
    if (!('geolocation' in navigator)) {
      MapManager.init();
      loadMockTerritories(55.751244, 37.618423);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        MapManager.init(lat, lng);
        MapManager.updateUserMarker(lat, lng);
        loadMockTerritories(lat, lng);
      },
      () => {
        // Permission denied or error – use Moscow as default
        MapManager.init(55.751244, 37.618423);
        loadMockTerritories(55.751244, 37.618423);
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }

  function loadMockTerritories(lat, lng) {
    Storage.generateMockTerritories(lat, lng);
    MapManager.renderAllTerritories();
  }

  // ---- Tab switching ----
  function switchTab(tab) {
    if (tab === currentTab) return;
    currentTab = tab;

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'map') {
      // Force Leaflet redraw after panel becomes visible
      setTimeout(() => MapManager.getMap && MapManager.getMap()?.invalidateSize(), 50);
    } else if (tab === 'runs') {
      renderRuns();
    } else if (tab === 'profile') {
      renderProfile();
    }
  }

  // ---- Start / Stop tracking (called from button) ----
  function toggleTracking() {
    if (isTracking) stopTracking(true);
    else startTracking();
  }

  function startTracking() {
    isTracking = true;
    const btn   = document.getElementById('btn-track');
    const label = document.getElementById('btn-track-label');
    const icon  = document.getElementById('btn-track-icon');
    btn.classList.add('running');
    label.textContent = 'Завершить';
    icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';

    MapManager.startRoute();
    Tracker.start();
    showToast('Трекинг запущен');
  }

  function stopTracking(manual = true) {
    isTracking = false;
    const btn   = document.getElementById('btn-track');
    const label = document.getElementById('btn-track-label');
    const icon  = document.getElementById('btn-track-icon');
    btn.classList.remove('running');
    label.textContent = 'Начать пробежку';
    icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';

    const result = Tracker.stop();
    document.getElementById('stats-bar').classList.add('hidden');
    document.getElementById('closure-hint').classList.add('hidden');

    if (result && result.points.length >= 10) {
      finishRun(result);
    } else {
      MapManager.clearRoute();
      if (manual) showToast('Маршрут слишком короткий', 'error');
    }
  }

  // ---- Closure confirm (called when user taps the closure hint) ----
  function closureConfirm() {
    if (!isTracking) return;
    stopTracking(true);
  }

  // ---- Finish run & process territory ----
  function finishRun(result) {
    const { points, totalDistance, duration } = result;
    const user = Storage.getUser();

    // Attempt to create territory
    const terrResult = TerritoryManager.createTerritory(points, user);

    // Save run record
    const run = {
      id:          'run_' + Date.now(),
      userId:      user.id,
      date:        Date.now(),
      distance:    Math.round(totalDistance),
      duration,
      path:        points.map(p => [p.lat, p.lng]),
      territoryId: terrResult?.territory?.id || null,
      area:        terrResult?.territory?.area || 0,
    };
    Storage.saveRun(run);

    MapManager.clearRoute();
    MapManager.renderAllTerritories();

    if (terrResult) {
      const { territory, capturedFrom } = terrResult;
      const captured = capturedFrom.length > 0
        ? ` Захвачено у ${capturedFrom.length} игрок(а)!`
        : '';
      showToast(`Территория ${formatArea(territory.area)} захвачена!${captured}`, 'success');
      MapManager.fitToTerritory(territory);
    } else {
      showToast('Маршрут не замкнулся — попробуй снова', 'error');
    }

    // Update profile counters
    renderProfile();
  }

  // ---- Render runs list ----
  function renderRuns() {
    const runs = Storage.getRuns();
    const list = document.getElementById('runs-list');
    const summary = document.getElementById('runs-summary');

    if (runs.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
          <p>Ещё нет пробежек.<br/>Запусти первый трекинг!</p>
        </div>`;
      summary.classList.add('hidden');
      return;
    }

    const totalArea = runs.reduce((s, r) => s + (r.area || 0), 0);
    document.getElementById('total-runs').textContent = runs.length;
    document.getElementById('total-area-display').textContent = formatArea(totalArea);
    summary.classList.remove('hidden');

    const user = Storage.getUser();
    list.innerHTML = runs.map(run => {
      const date = new Date(run.date).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
      const time = formatDuration(run.duration);
      const dist = (run.distance / 1000).toFixed(2);
      return `
        <div class="run-card">
          <div class="run-card-dot" style="background:${user.color}"></div>
          <div class="run-card-info">
            <div class="run-card-date">${date}</div>
            <div class="run-card-title">${dist} км · ${time}</div>
            ${run.area ? `<div class="run-card-sub">+${formatArea(run.area)} захвачено</div>` : ''}
          </div>
          ${run.area ? `<div class="run-card-area">${formatArea(run.area)}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ---- Render profile ----
  function renderProfile() {
    const user = Storage.getUser();
    if (!user) return;

    document.getElementById('profile-name').textContent = user.username;
    const avatar = document.getElementById('profile-avatar');
    if (user.avatar) avatar.src = user.avatar;
    document.querySelector('.profile-avatar-ring').style.borderColor = user.color;

    const runs  = Storage.getRuns();
    const area  = TerritoryManager.totalOwnedArea();
    document.getElementById('prof-area').textContent = formatArea(area);
    document.getElementById('prof-runs').textContent = runs.length;

    // Highlight active color swatch
    document.querySelectorAll('.color-swatch').forEach(b => {
      b.classList.toggle('active', b.dataset.color === user.color);
    });

    // Leaderboard
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const entries = Storage.getLeaderboard();
    const lb = document.getElementById('leaderboard');
    const ranks = ['gold', 'silver', 'bronze'];
    lb.innerHTML = entries.map((e, i) => {
      const rankClass = ranks[i] || '';
      const rankNum   = i + 1;
      return `
        <div class="lb-item ${e.isMe ? 'me' : ''}">
          <span class="lb-rank ${rankClass}">${rankNum}</span>
          <img class="lb-avatar" src="${e.avatar}"
               onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent((e.username||'?')[0])}&background=${(e.color||'6c63ff').replace('#','')}&color=fff&size=64'"
               alt="${e.username}" />
          <span class="lb-name">${e.username}${e.isMe ? ' (Вы)' : ''}</span>
          <span class="lb-area">${formatArea(e.area)}</span>
        </div>`;
    }).join('');
  }

  // ---- Update own territory color ----
  function updateOwnTerritoryColor(newColor) {
    const user = Storage.getUser();
    const territories = Storage.getTerritories().map(t => ({ ...t, color: newColor }));
    Storage.saveTerritories(territories);
    MapManager.renderAllTerritories();
  }

  // ---- Toast ----
  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  // ---- Helpers ----
  function formatArea(m2) {
    if (!m2) return '0 м²';
    if (m2 >= 1000000) return (m2 / 1000000).toFixed(2) + ' км²';
    if (m2 >= 10000)   return Math.round(m2 / 10000) + ' га';
    return Math.round(m2).toLocaleString('ru') + ' м²';
  }

  function formatDuration(sec) {
    if (!sec) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  // ---- Expose MapManager.getMap for Leaflet invalidateSize ----
  // (MapManager.getMap returns the Leaflet map instance)

  // ---- Public API ----
  return {
    init,
    switchTab,
    toggleTracking,
    startTracking,
    stopTracking,
    closureConfirm,
    showToast,
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);

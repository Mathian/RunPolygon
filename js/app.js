/**
 * app.js – Application entry point
 * Handles Firebase auth, uid resolution, consent screen, and all UI logic.
 */
const App = (() => {

  const tg = window.Telegram?.WebApp;
  let currentTab = 'map';
  let isTracking = false;
  let toastTimer = null;

  // ─── Entry point (async) ──────────────────────────────────────────
  async function init() {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#0f0f14');
      tg.setBackgroundColor('#0f0f14');
    }

    // Resolve UID: URL param wins, then localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const urlUid    = urlParams.get('uid');
    if (urlUid) {
      localStorage.setItem('rz_uid', urlUid);
      window.history.replaceState({}, '', window.location.pathname);
    }
    const uid = urlUid || localStorage.getItem('rz_uid');

    if (!uid) {
      _loadingError('Откройте приложение через Telegram-бот');
      return;
    }

    try {
      await FirebaseDB.init();
      await Storage.load(uid);
    } catch (e) {
      console.error('[App.init] Firebase error:', e);
      _loadingError('Ошибка подключения. Попробуйте ещё раз.');
      return;
    }

    if (!Storage.getUser()) {
      _loadingError('Аккаунт не найден. Воспользуйтесь ботом для регистрации.');
      return;
    }

    // Check consent
    let fbUser = null;
    try { fbUser = await FirebaseDB.getUser(uid); } catch { /* ignore */ }

    document.getElementById('loading-screen').classList.add('hidden');

    if (!fbUser?.consentGiven) {
      _showConsentScreen(uid);
    } else {
      _startApp();
    }
  }

  function _loadingError(msg) {
    document.getElementById('loading-screen').innerHTML = `
      <div class="loading-content">
        <div class="loading-icon" style="color:var(--accent)">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div class="loading-msg">${msg}</div>
      </div>`;
  }

  function _showConsentScreen(uid) {
    document.getElementById('consent-screen').classList.remove('hidden');
    document.getElementById('btn-consent-accept').onclick = async () => {
      const btn = document.getElementById('btn-consent-accept');
      btn.disabled = true;
      try {
        await FirebaseDB.setConsent(uid);
        document.getElementById('consent-screen').classList.add('hidden');
        _startApp();
      } catch (e) {
        console.error('[consent]', e);
        btn.disabled = false;
      }
    };
  }

  function _startApp() {
    _setupColorPicker();
    _requestLocationAndInit();
    renderProfile();
  }

  // ─── Color picker ─────────────────────────────────────────────────
  function _setupColorPicker() {
    const user = Storage.getUser();
    if (!user) return;
    document.querySelectorAll('.color-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === user.color);
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const u   = Storage.getUser();
        u.color   = btn.dataset.color;
        Storage.saveUser(u);
        document.querySelector('.profile-avatar-ring').style.borderColor = u.color;
        showToast('Цвет территории обновлён');
        _updateOwnTerritoryColor(u.color);
      });
    });
  }

  // ─── GPS + Map init ───────────────────────────────────────────────
  function _requestLocationAndInit() {
    if (!('geolocation' in navigator)) {
      MapManager.init();
      _loadTerritories(55.751244, 37.618423);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        MapManager.init(lat, lng);
        MapManager.updateUserMarker(lat, lng);
        await _loadTerritories(lat, lng);
      },
      async () => {
        MapManager.init(55.751244, 37.618423);
        await _loadTerritories(55.751244, 37.618423);
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }

  async function _loadTerritories(lat, lng) {
    await Storage.generateMockTerritories(lat, lng);
    MapManager.renderAllTerritories();
  }

  // ─── Tab switching ────────────────────────────────────────────────
  function switchTab(tab) {
    if (tab === currentTab) return;
    currentTab = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
    if (tab === 'map') {
      setTimeout(() => MapManager.getMap?.()?.invalidateSize(), 50);
    } else if (tab === 'runs') {
      _renderRuns();
    } else if (tab === 'profile') {
      renderProfile();
    }
  }

  // ─── Tracking ─────────────────────────────────────────────────────
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
      _finishRun(result);
    } else {
      MapManager.clearRoute();
      if (manual) showToast('Маршрут слишком короткий', 'error');
    }
  }

  function closureConfirm() {
    if (!isTracking) return;
    stopTracking(true);
  }

  // ─── Finish run ───────────────────────────────────────────────────
  function _finishRun(result) {
    const { points, totalDistance, duration } = result;
    const user      = Storage.getUser();
    const terrResult = TerritoryManager.createTerritory(points, user);

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
      showToast(`Территория ${_formatArea(territory.area)} захвачена!${captured}`, 'success');
      MapManager.fitToTerritory(territory);
    } else {
      showToast('Маршрут не замкнулся — попробуй снова', 'error');
    }
    renderProfile();
  }

  // ─── Runs tab ─────────────────────────────────────────────────────
  function _renderRuns() {
    const runs    = Storage.getRuns();
    const list    = document.getElementById('runs-list');
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
    document.getElementById('total-area-display').textContent = _formatArea(totalArea);
    summary.classList.remove('hidden');

    const user = Storage.getUser();
    list.innerHTML = runs.map(run => {
      const date = new Date(run.date).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
      const time = _formatDuration(run.duration);
      const dist = (run.distance / 1000).toFixed(2);
      return `
        <div class="run-card">
          <div class="run-card-dot" style="background:${user.color}"></div>
          <div class="run-card-info">
            <div class="run-card-date">${date}</div>
            <div class="run-card-title">${dist} км · ${time}</div>
            ${run.area ? `<div class="run-card-sub">+${_formatArea(run.area)} захвачено</div>` : ''}
          </div>
          ${run.area ? `<div class="run-card-area">${_formatArea(run.area)}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ─── Profile tab ──────────────────────────────────────────────────
  function renderProfile() {
    const user = Storage.getUser();
    if (!user) return;
    document.getElementById('profile-name').textContent = user.username;
    const avatarEl = document.getElementById('profile-avatar');
    if (user.avatar) avatarEl.src = user.avatar;
    document.querySelector('.profile-avatar-ring').style.borderColor = user.color;
    const area = TerritoryManager.totalOwnedArea();
    document.getElementById('prof-area').textContent = _formatArea(area);
    document.getElementById('prof-runs').textContent  = Storage.getRuns().length;
    document.querySelectorAll('.color-swatch').forEach(b => {
      b.classList.toggle('active', b.dataset.color === user.color);
    });
    _renderLeaderboard();
  }

  function _renderLeaderboard() {
    const entries = Storage.getLeaderboard();
    const lb      = document.getElementById('leaderboard');
    const ranks   = ['gold', 'silver', 'bronze'];
    lb.innerHTML = entries.map((e, i) => `
      <div class="lb-item ${e.isMe ? 'me' : ''}">
        <span class="lb-rank ${ranks[i] || ''}">${i + 1}</span>
        <img class="lb-avatar"
             src="${e.avatar || ''}"
             onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent((e.username||'?')[0])}&background=${(e.color||'6c63ff').replace('#','')}&color=fff&size=64'"
             alt="${e.username}" />
        <span class="lb-name">${e.username}${e.isMe ? ' (Вы)' : ''}</span>
        <span class="lb-area">${_formatArea(e.area)}</span>
      </div>`).join('');
  }

  function _updateOwnTerritoryColor(newColor) {
    const territories = Storage.getTerritories().map(t => ({ ...t, color: newColor }));
    Storage.saveTerritories(territories);
    MapManager.renderAllTerritories();
  }

  // ─── Toast ────────────────────────────────────────────────────────
  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className   = 'toast' + (type ? ' ' + type : '');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  function _formatArea(m2) {
    if (!m2) return '0 м²';
    if (m2 >= 1000000) return (m2 / 1000000).toFixed(2) + ' км²';
    return Math.round(m2).toLocaleString('ru') + ' м²';
  }

  function _formatDuration(sec) {
    if (!sec) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  return {
    init,
    switchTab,
    toggleTracking,
    startTracking,
    stopTracking,
    closureConfirm,
    showToast,
    renderProfile,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);

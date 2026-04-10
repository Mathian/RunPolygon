/**
 * storage.js – In-memory data store, synced to Firebase Firestore.
 * All public methods remain synchronous so existing code (territory.js,
 * tracking.js, map.js) needs no changes. Firebase writes happen in the
 * background (fire-and-forget with error logging).
 *
 * Call Storage.load(uid) once on app start and await it – after that all
 * getters return data from the in-memory cache.
 */
const Storage = (() => {

  let _uid         = null;
  let _user        = null;
  let _runs        = [];
  let _territories = [];
  let _otherTerr   = [];
  let _otherLoaded = false;

  // ─── Bootstrap from Firebase ──────────────────────────────────────
  async function load(uid) {
    _uid = uid;
    try {
      const fbUser = await FirebaseDB.getUser(uid);
      if (!fbUser) return; // new user – will be populated after consent

      _user = {
        id:       uid,
        username: fbUser.firstName || fbUser.username || 'Игрок',
        avatar:   fbUser.avatar    || null,
        color:    fbUser.color     || '#6c63ff',
        phone:    fbUser.phone     || '',
        tgId:     fbUser.tgId      || '',
      };

      // Restore territory polygon
      if (fbUser.territory?.polygonJson) {
        try {
          const t   = { ...fbUser.territory };
          t.polygon = JSON.parse(t.polygonJson);
          _territories = [t];
        } catch { _territories = []; }
      }

      // Load run history
      _runs = await FirebaseDB.getRuns(uid);

    } catch (e) {
      console.warn('[Storage] Firebase load error:', e);
    }
  }

  // ─── User ─────────────────────────────────────────────────────────
  function getUser() { return _user; }

  function saveUser(user) {
    _user = user;
    if (_uid) {
      FirebaseDB.saveUser(_uid, {
        firstName: user.username,
        color:     user.color,
        avatar:    user.avatar || '',
      }).catch(e => console.warn('[Storage.saveUser]', e));
    }
  }

  // ─── Runs ─────────────────────────────────────────────────────────
  function getRuns() { return _runs; }

  function saveRun(run) {
    _runs.unshift(run);
    if (_uid) {
      FirebaseDB.saveRun(_uid, run)
        .catch(e => console.warn('[Storage.saveRun]', e));
    }
  }

  // ─── Own territories ──────────────────────────────────────────────
  function getTerritories() { return _territories; }

  function saveTerritories(territories) {
    _territories = territories;
    if (_uid && territories.length > 0) {
      FirebaseDB.saveTerritory(_uid, territories[0])
        .catch(e => console.warn('[Storage.saveTerritory]', e));
    }
  }

  function addTerritory(territory) {
    saveTerritories([...getTerritories(), territory]);
  }

  // ─── Other players' territories ───────────────────────────────────
  function getOtherTerritories() { return _otherTerr; }
  function saveOtherTerritories(list) { _otherTerr = list; }

  /**
   * Load real players from Firebase, pad with mocks to keep the map
   * populated before real users join. Returns the list.
   * Idempotent – subsequent calls return cached result.
   */
  async function generateMockTerritories(centerLat, centerLng) {
    if (_otherLoaded) return _otherTerr;
    _otherLoaded = true;

    let real = [];
    try {
      const all = await FirebaseDB.getAllPlayers();
      real = all
        .filter(p => p.uid !== _uid && p.territory?.polygonJson)
        .map(p => {
          try {
            const t   = { ...p.territory };
            t.polygon = JSON.parse(t.polygonJson);
            return t;
          } catch { return null; }
        })
        .filter(Boolean);
    } catch { /* Firebase unavailable – use mocks only */ }

    const mockCount = Math.max(0, 4 - real.length);
    _otherTerr = [...real, ..._buildMocks(centerLat, centerLng, mockCount)];
    return _otherTerr;
  }

  function _buildMocks(lat, lng, count) {
    if (count === 0) return [];
    const players = [
      { id: 'p1', username: 'AlexRunner', color: '#ff6b6b',
        avatar: 'https://ui-avatars.com/api/?name=AR&background=ff6b6b&color=fff&size=64', runs: 23 },
      { id: 'p2', username: 'Marina_V',   color: '#4ecdc4',
        avatar: 'https://ui-avatars.com/api/?name=MV&background=4ecdc4&color=fff&size=64', runs: 15 },
      { id: 'p3', username: 'Kos',        color: '#f9ca24',
        avatar: 'https://ui-avatars.com/api/?name=KO&background=f9ca24&color=333&size=64', runs: 8  },
      { id: 'p4', username: 'SportsFan',  color: '#fd9644',
        avatar: 'https://ui-avatars.com/api/?name=SF&background=fd9644&color=fff&size=64', runs: 31 },
    ].slice(0, count);

    const R = 0.003;
    const shapes = [
      [[0,0],[0,R*1.2],[R*.8,R*1.2],[R*.8,0],[0,0]],
      [[0,0],[0,R],[R*.6,R*1.4],[R*1.,R*.5],[R*.4,-R*.3],[0,0]],
      [[0,0],[0,R*.9],[R*.5,R*1.1],[R*.9,R*.4],[R*.7,-R*.2],[0,0]],
      [[0,0],[0,R*.7],[R*.7,R*.7],[R*.7,0],[0,0]],
    ];
    const offsets = [[.006,.008],[.009,-.005],[-.005,.010],[-.008,-.004]];

    return players.map((p, i) => {
      const [dLat, dLng] = offsets[i];
      const coords = shapes[i].map(([a, b]) => [lng + dLng + b, lat + dLat + a]);
      const poly   = turf.polygon([coords]);
      const area   = Math.round(turf.area(poly));
      return {
        id: 'mock_' + p.id, userId: p.id, username: p.username,
        color: p.color, avatar: p.avatar, runs: p.runs,
        area, polygon: poly,
        createdAt: Date.now() - Math.random() * 7 * 86400000,
      };
    });
  }

  // ─── Leaderboard ──────────────────────────────────────────────────
  function getLeaderboard() {
    const myArea  = _territories.reduce((s, t) => s + (t.area || 0), 0);
    const entries = _otherTerr.map(t => ({
      userId: t.userId, username: t.username, avatar: t.avatar,
      color: t.color,   area: t.area || 0,    runs: t.runs || 0,
      isMe: false,
    }));
    if (_user) {
      entries.push({
        userId: _user.id, username: _user.username, avatar: _user.avatar,
        color: _user.color, area: myArea, runs: _runs.length, isMe: true,
      });
    }
    entries.sort((a, b) => b.area - a.area);
    return entries;
  }

  return {
    load,
    getUser, saveUser,
    getRuns, saveRun,
    getTerritories, saveTerritories, addTerritory,
    getOtherTerritories, saveOtherTerritories, generateMockTerritories,
    getLeaderboard,
  };
})();

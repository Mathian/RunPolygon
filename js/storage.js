/**
 * storage.js – Data persistence layer
 * Currently uses localStorage. Replace the methods below with API calls
 * to connect a real backend (Supabase, Firebase, etc.)
 */
const Storage = (() => {

  const KEYS = {
    USER:        'rz_user',
    RUNS:        'rz_runs',
    TERRITORIES: 'rz_territories',
    OTHER_TERR:  'rz_other_territories',
  };

  // ---------- helpers ----------
  function _get(key) {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }
  function _set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ===================================================
  // USER
  // ===================================================
  function getUser() {
    return _get(KEYS.USER);
  }

  function saveUser(user) {
    _set(KEYS.USER, user);
    // BACKEND HOOK: await api.put('/users/' + user.id, user);
  }

  // ===================================================
  // RUNS
  // ===================================================
  function getRuns() {
    return _get(KEYS.RUNS) || [];
  }

  function saveRun(run) {
    const runs = getRuns();
    // Prepend newest first
    runs.unshift(run);
    _set(KEYS.RUNS, runs);
    // BACKEND HOOK: await api.post('/runs', run);
  }

  // ===================================================
  // OWN TERRITORIES
  // ===================================================
  function getTerritories() {
    return _get(KEYS.TERRITORIES) || [];
  }

  function saveTerritories(territories) {
    _set(KEYS.TERRITORIES, territories);
    // BACKEND HOOK: await api.put('/territories/mine', territories);
  }

  function addTerritory(territory) {
    const list = getTerritories();
    list.push(territory);
    saveTerritories(list);
  }

  // ===================================================
  // OTHER PLAYERS' TERRITORIES (fetched from backend)
  // For MVP: generated mock data, cached in localStorage
  // ===================================================
  function getOtherTerritories() {
    return _get(KEYS.OTHER_TERR) || [];
  }

  function saveOtherTerritories(list) {
    _set(KEYS.OTHER_TERR, list);
  }

  /**
   * Generate realistic mock territories near a lat/lng.
   * Replace with: const res = await api.get('/territories/nearby?lat=&lng=&r=5000')
   */
  function generateMockTerritories(centerLat, centerLng) {
    const existing = getOtherTerritories();
    if (existing.length > 0) return existing; // already generated

    const players = [
      { id: 'p1', username: 'AlexRunner', color: '#ff6b6b',
        avatar: 'https://ui-avatars.com/api/?name=AR&background=ff6b6b&color=fff&size=64', runs: 23, area: 0 },
      { id: 'p2', username: 'Marina_V',   color: '#4ecdc4',
        avatar: 'https://ui-avatars.com/api/?name=MV&background=4ecdc4&color=fff&size=64', runs: 15, area: 0 },
      { id: 'p3', username: 'Kos',        color: '#f9ca24',
        avatar: 'https://ui-avatars.com/api/?name=KO&background=f9ca24&color=333&size=64', runs: 8,  area: 0 },
      { id: 'p4', username: 'SportsFan',  color: '#fd9644',
        avatar: 'https://ui-avatars.com/api/?name=SF&background=fd9644&color=fff&size=64', runs: 31, area: 0 },
    ];

    const R = 0.003; // ~300m radius offsets
    const shapes = [
      // rough rectangle offsets [dLat, dLng] for polygon vertices
      [ [0,0],[0,R*1.2],[R*0.8,R*1.2],[R*0.8,0],[0,0] ],
      [ [0,0],[0,R],[R*0.6,R*1.4],[R*1.0,R*0.5],[R*0.4,-R*0.3],[0,0] ],
      [ [0,0],[0,R*0.9],[R*0.5,R*1.1],[R*0.9,R*0.4],[R*0.7,-R*0.2],[0,0] ],
      [ [0,0],[0,R*0.7],[R*0.7,R*0.7],[R*0.7,0],[0,0] ],
    ];

    const centerOffsets = [
      [0.006,  0.008],
      [0.009, -0.005],
      [-0.005, 0.010],
      [-0.008,-0.004],
    ];

    const territories = players.map((p, i) => {
      const [dLat, dLng] = centerOffsets[i];
      const baseLat = centerLat + dLat;
      const baseLng = centerLng + dLng;
      const coords = shapes[i].map(([a, b]) => [baseLng + b, baseLat + a]); // [lng, lat] for GeoJSON
      const poly = turf.polygon([coords]);
      const area = Math.round(turf.area(poly));
      p.area = area;
      return {
        id:       'mock_' + p.id,
        userId:   p.id,
        username: p.username,
        color:    p.color,
        avatar:   p.avatar,
        runs:     p.runs,
        area,
        polygon:  poly,
        createdAt: Date.now() - Math.random() * 7 * 86400000,
      };
    });

    saveOtherTerritories(territories);
    return territories;
  }

  // ===================================================
  // LEADERBOARD
  // ===================================================
  function getLeaderboard(currentUserId) {
    const others  = getOtherTerritories();
    const myTerrs = getTerritories();
    const myArea  = myTerrs.reduce((s, t) => s + (t.area || 0), 0);

    const user = getUser();
    const entries = others.map(t => ({
      userId:   t.userId,
      username: t.username,
      avatar:   t.avatar,
      color:    t.color,
      area:     t.area || 0,
      runs:     t.runs || 0,
      isMe:     false,
    }));

    if (user) {
      entries.push({
        userId:   user.id,
        username: user.username,
        avatar:   user.avatar,
        color:    user.color,
        area:     myArea,
        runs:     getRuns().length,
        isMe:     true,
      });
    }

    entries.sort((a, b) => b.area - a.area);
    return entries;
  }

  return {
    getUser, saveUser,
    getRuns, saveRun,
    getTerritories, saveTerritories, addTerritory,
    getOtherTerritories, saveOtherTerritories, generateMockTerritories,
    getLeaderboard,
  };
})();

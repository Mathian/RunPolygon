/**
 * firebase.js – Firebase initialisation and Firestore helpers
 * Requires Firebase 10.x compat SDK loaded via CDN.
 */
const FirebaseDB = (() => {
  let _db    = null;
  let _auth  = null;
  let _ready = false;

  // ─── Init ─────────────────────────────────────────────────────────
  async function init() {
    if (_ready) return;

    firebase.initializeApp({
      apiKey:            'AIzaSyDBDCL5RwFn70h6su3IsWRlK6wtl3D53K4',
      authDomain:        'runpolygon.firebaseapp.com',
      projectId:         'runpolygon',
      storageBucket:     'runpolygon.firebasestorage.app',
      messagingSenderId: '196430224066',
      appId:             '1:196430224066:web:9cc693accfb2e92bb6795b',
    });

    _db   = firebase.firestore();
    _auth = firebase.auth();

    await _auth.signInAnonymously();
    _ready = true;
  }

  // ─── Users ────────────────────────────────────────────────────────
  async function getUser(uid) {
    const snap = await _db.collection('users').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function saveUser(uid, data) {
    await _db.collection('users').doc(uid).set(data, { merge: true });
  }

  async function setConsent(uid) {
    await _db.collection('users').doc(uid).set({
      consentGiven: true,
      consentAt:    new Date().toISOString(),
    }, { merge: true });
  }

  // ─── Runs ─────────────────────────────────────────────────────────
  async function getRuns(uid) {
    const snap = await _db.collection('users').doc(uid)
      .collection('runs').orderBy('date', 'desc').limit(200).get();
    return snap.docs.map(d => d.data());
  }

  async function saveRun(uid, run) {
    // Strip path (too large for Firestore) before saving
    const { path: _path, ...runData } = run;
    await _db.collection('users').doc(uid)
      .collection('runs').doc(run.id).set(runData);
    await _db.collection('users').doc(uid).set(
      { runs_count: firebase.firestore.FieldValue.increment(1) },
      { merge: true }
    );
  }

  // ─── Territory ────────────────────────────────────────────────────
  async function saveTerritory(uid, territory) {
    const payload = {
      id:          territory.id,
      userId:      territory.userId,
      username:    territory.username,
      color:       territory.color,
      avatar:      territory.avatar      || '',
      area:        territory.area        || 0,
      capturedAt:  territory.capturedAt  || Date.now(),
      polygonJson: JSON.stringify(territory.polygon),
    };
    await _db.collection('users').doc(uid).set(
      { territory: payload, area: payload.area },
      { merge: true }
    );
  }

  // ─── All players (leaderboard / other territories on map) ─────────
  async function getAllPlayers() {
    const snap = await _db.collection('users')
      .orderBy('area', 'desc').limit(50).get();
    return snap.docs.map(d => d.data());
  }

  return {
    init,
    getUser, saveUser, setConsent,
    getRuns, saveRun,
    saveTerritory,
    getAllPlayers,
  };
})();

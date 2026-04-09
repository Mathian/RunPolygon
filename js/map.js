/**
 * map.js – Leaflet map, territory/route rendering
 */
const MapManager = (() => {

  let map          = null;
  let userMarker   = null;
  let routeLayer   = null;       // Polyline for active route
  let routePoints  = [];         // [lat, lng] pairs for current run
  let terrLayers   = new Map();  // id → { polygon, marker }

  // ---- Init ----
  function init(lat = 55.751244, lng = 37.618423) {
    if (map) return;

    map = L.map('map', {
      center: [lat, lng],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    // Dark tile layer (Carto Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    // Attribution (small)
    L.control.attribution({ position: 'bottomright', prefix: '' })
      .addAttribution('© <a href="https://carto.com">CARTO</a>')
      .addTo(map);

    // Zoom control top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Draw existing territories on load
    renderAllTerritories();
  }

  // ---- Center map on user ----
  function centerOn(lat, lng, zoom) {
    if (!map) return;
    map.setView([lat, lng], zoom || map.getZoom(), { animate: true });
  }

  // ---- User location marker ----
  function updateUserMarker(lat, lng) {
    if (!map) return;
    if (!userMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lng]);
    }
  }

  // ---- Route drawing ----
  function startRoute() {
    routePoints = [];
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  }

  function addRoutePoint(lat, lng) {
    if (!map) return;
    routePoints.push([lat, lng]);

    if (!routeLayer) {
      routeLayer = L.polyline(routePoints, {
        color: '#ffffff',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);
    } else {
      routeLayer.setLatLngs(routePoints);
    }
  }

  function clearRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    routePoints = [];
  }

  // ---- Territory rendering ----
  function renderAllTerritories() {
    if (!map) return;

    // Clear existing layers
    terrLayers.forEach(({ polygon, marker }) => {
      map.removeLayer(polygon);
      if (marker) map.removeLayer(marker);
    });
    terrLayers.clear();

    const all = [
      ...Storage.getOtherTerritories(),
      ...Storage.getTerritories(),
    ];

    all.forEach(t => renderTerritory(t));
  }

  function renderTerritory(territory) {
    if (!map || !territory.polygon) return;

    // Convert GeoJSON polygon to Leaflet latlngs
    let coords;
    try {
      coords = territory.polygon.geometry.coordinates[0];
    } catch { return; }
    const latlngs = coords.map(c => [c[1], c[0]]);

    // Polygon layer
    const polygonLayer = L.polygon(latlngs, {
      color:       territory.color,
      weight:      2.5,
      opacity:     0.9,
      fillColor:   territory.color,
      fillOpacity: 0.22,
      className:   'territory-polygon',
    }).addTo(map);

    polygonLayer.on('click', () => showTerritoryPopup(territory));

    // Profile marker at centroid
    let markerLayer = null;
    try {
      const centroid = turf.centroid(territory.polygon);
      const [cLng, cLat] = centroid.geometry.coordinates;

      const avatarIcon = L.divIcon({
        className: '',
        html: `
          <div class="territory-marker-wrap" onclick="MapManager.showTerritoryPopup(${JSON.stringify(territory).replace(/"/g, '&quot;')})">
            <img class="territory-marker-img"
                 src="${territory.avatar || ''}"
                 style="border-color:${territory.color}"
                 onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent((territory.username||'?')[0])}&background=${territory.color.replace('#','')}&color=fff&size=64'"
            />
            <span class="territory-marker-name">${territory.username || ''}</span>
          </div>`,
        iconSize:   [72, 56],
        iconAnchor: [36, 20],
      });
      markerLayer = L.marker([cLat, cLng], { icon: avatarIcon, interactive: false }).addTo(map);
    } catch { /* centroid failed – no marker */ }

    terrLayers.set(territory.id, { polygon: polygonLayer, marker: markerLayer });
  }

  function removeTerritory(id) {
    const layers = terrLayers.get(id);
    if (layers) {
      map.removeLayer(layers.polygon);
      if (layers.marker) map.removeLayer(layers.marker);
      terrLayers.delete(id);
    }
  }

  // ---- Territory popup ----
  function showTerritoryPopup(territory) {
    const popup = document.getElementById('territory-popup');
    document.getElementById('popup-avatar').src = territory.avatar ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent((territory.username||'?')[0])}&background=${(territory.color||'#6c63ff').replace('#','')}&color=fff&size=64`;
    document.getElementById('popup-name').textContent = territory.username || 'Игрок';
    document.getElementById('popup-area').textContent = formatArea(territory.area || 0);
    document.getElementById('popup-runs').textContent = territory.runs || '—';
    popup.classList.remove('hidden');
  }

  function closePopup() {
    document.getElementById('territory-popup').classList.add('hidden');
  }

  // ---- Fit map to territory bounds ----
  function fitToTerritory(territory) {
    if (!map || !territory.polygon) return;
    try {
      const bbox = turf.bbox(territory.polygon);
      map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [40, 40] });
    } catch { /* skip */ }
  }

  // ---- Format helpers ----
  function formatArea(m2) {
    if (m2 >= 1000000) return (m2 / 1000000).toFixed(2) + ' км²';
    if (m2 >= 10000)   return Math.round(m2 / 10000) + ' га';
    return Math.round(m2).toLocaleString('ru') + ' м²';
  }

  function getMap() { return map; }

  return {
    init, centerOn, updateUserMarker,
    startRoute, addRoutePoint, clearRoute,
    renderAllTerritories, renderTerritory, removeTerritory,
    showTerritoryPopup, closePopup, fitToTerritory,
  };
})();

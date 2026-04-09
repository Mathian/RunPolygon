/**
 * territory.js – Territory capture logic
 * All polygon operations via Turf.js (GeoJSON, [lng, lat] order).
 */
const TerritoryManager = (() => {

  const MIN_AREA = 500; // m² – minimum valid territory

  // -------------------------------------------------------
  // Convert helpers
  // -------------------------------------------------------
  /** Leaflet LatLng[] → GeoJSON coordinate ring [[lng,lat],...] */
  function toRing(latlngs) {
    const ring = latlngs.map(p => [p.lng ?? p[1], p.lat ?? p[0]]);
    // Close the ring
    if (ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push(ring[0]);
    }
    return ring;
  }

  /** GeoJSON coordinate ring → Leaflet [lat, lng][] */
  function fromRing(ring) {
    return ring.map(c => [c[1], c[0]]);
  }

  // -------------------------------------------------------
  // Simplify route before creating polygon
  // Douglas-Peucker via Turf (tolerance in degrees ~1m ≈ 0.00001)
  // -------------------------------------------------------
  function simplifyRoute(latlngs) {
    if (latlngs.length < 3) return latlngs;
    const line = turf.lineString(latlngs.map(p => [p.lng ?? p[1], p.lat ?? p[0]]));
    const simplified = turf.simplify(line, { tolerance: 0.00005, highQuality: true });
    return simplified.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
  }

  // -------------------------------------------------------
  // Create a new territory from a closed route
  // Returns { territory, capturedFrom[] } or null if invalid
  // -------------------------------------------------------
  function createTerritory(rawLatlngs, user) {
    const simplified = simplifyRoute(rawLatlngs);
    if (simplified.length < 3) return null;

    const ring = toRing(simplified);
    let newPoly;
    try {
      newPoly = turf.polygon([ring]);
    } catch (e) {
      console.warn('Invalid polygon:', e);
      return null;
    }

    // Ensure valid geometry (no self-intersections via unkink)
    try {
      const unkinked = turf.unkinkPolygon(newPoly);
      if (unkinked.features.length === 0) return null;
      // Use largest piece
      newPoly = unkinked.features.reduce((best, f) =>
        turf.area(f) > turf.area(best) ? f : best
      );
    } catch (e) { /* keep original if unkink fails */ }

    const area = turf.area(newPoly);
    if (area < MIN_AREA) return null;

    // ---- Process captures against other territories ----
    const capturedFrom = [];
    const allTerritories = [
      ...Storage.getOtherTerritories(),
      ...Storage.getTerritories().filter(t => t.userId !== user.id),
    ];

    const processedOthers = [];
    for (const other of allTerritories) {
      if (!other.polygon) continue;

      let otherPoly;
      try {
        otherPoly = turf.polygon(other.polygon.geometry.coordinates);
      } catch { continue; }

      const intersection = turf.intersect(newPoly, otherPoly);
      if (!intersection) {
        processedOthers.push(other); // no overlap, untouched
        continue;
      }

      const intersectArea = turf.area(intersection);
      if (intersectArea < 1) {
        processedOthers.push(other);
        continue;
      }

      // Check if new polygon fully contains the other
      const fullyContained = turf.booleanContains(newPoly, otherPoly);
      if (fullyContained) {
        // Absorb entire territory
        capturedFrom.push({ from: other, captured: otherPoly, fullCapture: true });
        // Don't push other back – it's absorbed
      } else {
        // Partial capture: subtract intersection from their territory
        try {
          const remaining = turf.difference(otherPoly, newPoly);
          if (remaining && turf.area(remaining) > MIN_AREA) {
            processedOthers.push({
              ...other,
              polygon: remaining,
              area: Math.round(turf.area(remaining)),
            });
          }
          // else their territory is too small after capture – remove it
          capturedFrom.push({ from: other, captured: intersection, fullCapture: false });
        } catch (e) {
          processedOthers.push(other);
        }
      }
    }

    // ---- Merge with player's own existing territories ----
    const myTerritories = Storage.getTerritories().filter(t => t.userId === user.id);
    let mergedPoly = newPoly;
    for (const mine of myTerritories) {
      if (!mine.polygon) continue;
      try {
        const mp = turf.polygon(mine.polygon.geometry.coordinates);
        mergedPoly = turf.union(mergedPoly, mp);
      } catch { /* skip */ }
    }

    const finalArea = Math.round(turf.area(mergedPoly));

    const territory = {
      id:        'terr_' + Date.now(),
      userId:    user.id,
      username:  user.username,
      color:     user.color,
      avatar:    user.avatar,
      polygon:   mergedPoly,
      area:      finalArea,
      capturedAt: Date.now(),
    };

    // Persist updated other territories (mock + real)
    const updatedOthers = Storage.getOtherTerritories().map(ot => {
      const found = processedOthers.find(p => p.id === ot.id);
      return found || ot; // if not in processedOthers → it was absorbed
    }).filter(ot => processedOthers.some(p => p.id === ot.id));
    Storage.saveOtherTerritories(updatedOthers);

    // Replace all own territories with merged result
    Storage.saveTerritories([territory]);

    return { territory, capturedFrom };
  }

  // -------------------------------------------------------
  // Detect if route is approaching its start point
  // Returns distance in metres
  // -------------------------------------------------------
  function distanceToStart(currentLat, currentLng, startLat, startLng) {
    const from = turf.point([startLng, startLat]);
    const to   = turf.point([currentLng, currentLat]);
    return turf.distance(from, to, { units: 'meters' });
  }

  // -------------------------------------------------------
  // Calculate total owned area (m²)
  // -------------------------------------------------------
  function totalOwnedArea() {
    return Storage.getTerritories()
      .reduce((sum, t) => sum + (t.area || 0), 0);
  }

  return { createTerritory, distanceToStart, totalOwnedArea, fromRing };
})();

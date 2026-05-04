const map = new maplibregl.Map({
  container: 'map',

  // Empty style (no tiles)
  style: {
    version: 8,
    sources: {},
    layers: []
  },

  center: [-98.5, 39.8], // geographic center of USA
  zoom: 3
});

map.on('load', () => {

  // Load your GeoJSON
  map.addSource('counties', {
    type: 'geojson',
    data: 'combined_counties.geojson'
  });

  // Fill layer (this is your "pixel grid")
  map.addLayer({
    id: 'counties-fill',
    type: 'fill',
    source: 'counties',
    paint: {
      'fill-color': ['get', 'color'], // dynamic coloring
      'fill-opacity': 0.8
    }
  });

  // Outline layer (helps visually)
  map.addLayer({
    id: 'counties-outline',
    type: 'line',
    source: 'counties',
    paint: {
      'line-color': '#222',
      'line-width': 0.5
    }
  });

});
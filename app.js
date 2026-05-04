const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: []
  },
  center: [-98.5, 39.8],
  zoom: 3
});

let countiesData = null;

// -----------------------------
// MAP LOAD
// -----------------------------
map.on('load', async () => {

  const raw = await fetch('combined_counties.geojson')
    .then(r => r.json());

  // Normalize GeoJSON (CRITICAL FIX)
  countiesData = Array.isArray(raw)
    ? { type: "FeatureCollection", features: raw }
    : raw;

  if (!countiesData?.features) {
    console.error("Invalid GeoJSON:", countiesData);
    return;
  }

  map.addSource('counties', {
    type: 'geojson',
    data: countiesData
  });

  map.addLayer({
    id: 'counties-fill',
    type: 'fill',
    source: 'counties',
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], '#cccccc'],
      'fill-opacity': 0.8
    }
  });

  map.addLayer({
    id: 'counties-outline',
    type: 'line',
    source: 'counties',
    paint: {
      'line-color': '#222',
      'line-width': 0.5
    }
  });

  resizeCanvas();
  render();
});

// -----------------------------
// CANVAS + IMAGE
// -----------------------------
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

let img = new Image();

let imgState = {
  x: 0,
  y: 0,
  scale: 0.5
};

// -----------------------------
// RESIZE + RENDER LOOP
// -----------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}

function render() {
  if (!img || !img.complete || !img.width) return;

  const w = img.width * imgState.scale;
  const h = img.height * imgState.scale;

  imgState.x = canvas.width / 2 - w / 2;
  imgState.y = canvas.height / 2 - h / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, imgState.x, imgState.y, w, h);
}

map.on('resize', () => {
  resizeCanvas();
  render();
});

map.on('move', render);
map.on('zoom', render);
map.on('load', () => {
  resizeCanvas();
  render();
});

// -----------------------------
// IMAGE UPLOAD
// -----------------------------
document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    img = new Image();

    img.onload = () => {
      render();
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
});

// -----------------------------
// PIXEL SAMPLING
// -----------------------------
function getPixelColor(x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;

  if (!d || d.length < 3) return null;

  return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
}

// -----------------------------
// GEOMETRY HELPERS
// -----------------------------
function getRepresentativeCoords(geom) {
  if (!geom) return null;

  if (geom.type === "Polygon") {
    return geom.coordinates[0];
  }

  if (geom.type === "MultiPolygon") {
    return geom.coordinates?.[0]?.[0] || null;
  }

  return null;
}

function getCentroid(coords) {
  let x = 0, y = 0;

  coords.forEach(c => {
    x += c[0];
    y += c[1];
  });

  return [x / coords.length, y / coords.length];
}

// -----------------------------
// APPLY IMAGE → COUNTIES
// -----------------------------
document.getElementById('apply').addEventListener('click', () => {
  if (!countiesData?.features || !img.complete) return;

  // 1. Capture the entire canvas state once
  const canvasW = canvas.width;
  const canvasH = canvas.height;
  const pixelData = ctx.getImageData(0, 0, canvasW, canvasH).data;

  // 2. Clone the GeoJSON (MapLibre needs a new object to trigger a re-draw)
  const data = JSON.parse(JSON.stringify(countiesData));

  data.features.forEach(feature => {
    // 3. Get the center point of the county
    const coords = getRepresentativeCoords(feature.geometry);
    if (!coords) return;

    const centroid = getCentroid(coords);
    const point = map.project(centroid); // Converts [lng, lat] to [x, y] screen pixels

    const x = Math.floor(point.x);
    const y = Math.floor(point.y);

    // 4. Check if the county center falls within the canvas area
    if (x >= 0 && x < canvasW && y >= 0 && y < canvasH) {
      // Index formula for RGBA array: (row * width + column) * 4 bytes
      const i = (y * canvasW + x) * 4;
      
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];
      const a = pixelData[i + 3];

      // Only apply if the pixel isn't fully transparent
      if (a > 1) {
        feature.properties.color = `rgb(${r}, ${g}, ${b})`;
      } else {
        feature.properties.color = "#eeeeee"; // Default empty color
      }
    }
  });

  // 5. Update the source data - MapLibre handles the heavy lifting of re-coloring
  countiesData = data;
  map.getSource('counties').setData(data);
});

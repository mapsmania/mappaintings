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

let isDragging = false;
let startX, startY;

// -----------------------------
// MOUSE CONTROLS
// -----------------------------

// Dragging Logic
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.offsetX - imgState.x;
  startY = e.offsetY - imgState.y;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  // Update position based on mouse movement
  imgState.x = e.offsetX - startX;
  imgState.y = e.offsetY - startY;
  
  render();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// Scaling Logic (Mouse Wheel)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); // Stop the map from zooming

  const scaleAmount = e.deltaY * -0.001;
  const newScale = Math.min(Math.max(0.05, imgState.scale + scaleAmount), 5);
  
  // Optional: Adjust X/Y so it scales from the center
  const widthDiff = (img.width * newScale) - (img.width * imgState.scale);
  const heightDiff = (img.height * newScale) - (img.height * imgState.scale);
  
  imgState.x -= widthDiff / 2;
  imgState.y -= heightDiff / 2;
  imgState.scale = newScale;

  render();
}, { passive: false });

// -----------------------------
// MAP LOAD
// -----------------------------
map.on('load', async () => {

  const raw = await fetch('combined_counties.geojson')
    .then(r => r.json());

  countiesData = Array.isArray(raw)
    ? { type: "FeatureCollection", features: raw }
    : raw;

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
// RESIZE + RENDER
// -----------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}

function render() {
  if (!img || !img.complete || !img.width || canvas.style.display === "none") return;

  const w = img.width * imgState.scale;
  const h = img.height * imgState.scale;

  // REMOVE OR COMMENT OUT THESE TWO LINES:
  // imgState.x = canvas.width / 2 - w / 2;
  // imgState.y = canvas.height / 2 - h / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw a semi-transparent border so the user knows the "hitbox"
  ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(imgState.x, imgState.y, w, h);
  
  ctx.drawImage(img, imgState.x, imgState.y, w, h);
}

map.on('resize', () => {
  resizeCanvas();
  render();
});

map.on('move', render);
map.on('zoom', render);

// -----------------------------
// IMAGE UPLOAD
// -----------------------------
document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    img = new Image();
    img.onload = render;
    img.src = reader.result;
  };

  reader.readAsDataURL(file);
});

// -----------------------------
// GEOMETRY HELPERS
// -----------------------------
function getRepresentativeCoords(geom) {
  if (!geom) return null;

  if (geom.type === "Polygon") return geom.coordinates[0];
  if (geom.type === "MultiPolygon") return geom.coordinates?.[0]?.[0] || null;

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
// MULTI-SAMPLE OFFSETS
// -----------------------------
const sampleOffsets = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75]
];

// -----------------------------
// APPLY IMAGE → COUNTIES
// -----------------------------
document.getElementById('apply').addEventListener('click', () => {

  render();

  if (!countiesData?.features || !img.complete) return;

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  const pixelData = ctx.getImageData(0, 0, canvasW, canvasH).data;

  const data = JSON.parse(JSON.stringify(countiesData));

  data.features.forEach(feature => {

    const coords = getRepresentativeCoords(feature.geometry);
    if (!coords) return;

    const centroid = getCentroid(coords);

    let r = 0, g = 0, b = 0, count = 0;

    // -----------------------------
    // MULTI-SAMPLE LOOP
    // -----------------------------
    sampleOffsets.forEach(offset => {

      const point = map.project([
        centroid[0] + (offset[0] - 0.5) * 0.05,
        centroid[1] + (offset[1] - 0.5) * 0.05
      ]);

      const x = Math.floor(point.x);
      const y = Math.floor(point.y);

      if (x < 0 || y < 0 || x >= canvasW || y >= canvasH) return;

      const i = (y * canvasW + x) * 4;

      const a = pixelData[i + 3];
      if (a <= 1) return;

      r += pixelData[i];
      g += pixelData[i + 1];
      b += pixelData[i + 2];

      count++;
    });

    if (count === 0) {
      feature.properties.color = "#eeeeee";
      return;
    }

    feature.properties.color = `rgb(
      ${Math.floor(r / count)},
      ${Math.floor(g / count)},
      ${Math.floor(b / count)}
    )`;
  });

  countiesData = data;
  map.getSource('counties').setData(data);

  canvas.style.display = "none";
});

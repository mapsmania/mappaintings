// -----------------------------
// 1. INITIALIZE MAP
// -----------------------------
const map = new maplibregl.Map({
  container: 'map',
  preserveDrawingBuffer: true,
  style: {
    version: 8,
    sources: {},
    layers: []
  },
  center: [-98.5, 39.8],
  zoom: 3
});

// -----------------------------
// 2. STATE & GLOBALS
// -----------------------------
let countiesData = null;

const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

let img = new Image();

let imgState = {
  x: 50,
  y: 50,
  scale: 0.5
};

let isDragging = false;
let startX, startY;

let liveMode = false;
let liveInterval = null;

const sampleOffsets = [
  [0.25, 0.25], [0.75, 0.25],
  [0.25, 0.75], [0.75, 0.75]
];

// -----------------------------
// 3. CORE FUNCTIONS
// -----------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}

// 🔥 Continuous render loop
function render() {
  if (!img || !img.complete || !img.width) {
    requestAnimationFrame(render);
    return;
  }

  const w = img.width * imgState.scale;
  const h = img.height * imgState.scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Optional positioning border
  if (!liveMode) {
    ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(imgState.x, imgState.y, w, h);
  }

  ctx.drawImage(img, imgState.x, imgState.y, w, h);

  requestAnimationFrame(render);
}

// -----------------------------
// 4. INTERACTION LISTENERS
// -----------------------------
canvas.addEventListener('mousedown', (e) => {
  if (liveMode) return;
  isDragging = true;
  startX = e.offsetX - imgState.x;
  startY = e.offsetY - imgState.y;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging || liveMode) return;
  imgState.x = e.offsetX - startX;
  imgState.y = e.offsetY - startY;
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  if (!img.width || liveMode) return;
  e.preventDefault();

  const scaleAmount = e.deltaY * -0.001;
  const newScale = Math.min(Math.max(0.05, imgState.scale + scaleAmount), 5);

  const widthDiff = (img.width * newScale) - (img.width * imgState.scale);
  const heightDiff = (img.height * newScale) - (img.height * imgState.scale);

  imgState.x -= widthDiff / 2;
  imgState.y -= heightDiff / 2;
  imgState.scale = newScale;
}, { passive: false });

// -----------------------------
// 5. GEOMETRY HELPERS
// -----------------------------
function getRepresentativeCoords(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon") return geom.coordinates[0];
  if (geom.type === "MultiPolygon") return geom.coordinates?.[0]?.[0] || null;
  return null;
}

function getCentroid(coords) {
  let x = 0, y = 0;
  coords.forEach(c => { x += c[0]; y += c[1]; });
  return [x / coords.length, y / coords.length];
}

// -----------------------------
// 6. MAP LOAD
// -----------------------------
map.on('load', async () => {
  const raw = await fetch('combined_counties.geojson').then(r => r.json());

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
  render(); // 🔥 start loop
});

map.on('resize', resizeCanvas);

// -----------------------------
// 7. IMAGE UPLOAD
// -----------------------------
document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    img = new Image();

    img.onload = () => {
      // Show overlay for positioning
      canvas.style.opacity = 1;
      canvas.style.pointerEvents = "auto";

      liveMode = false;

      imgState.scale = 0.5;
      imgState.x = (canvas.width / 2) - (img.width * imgState.scale / 2);
      imgState.y = (canvas.height / 2) - (img.height * imgState.scale / 2);
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
});

// -----------------------------
// 8. APPLY → START LIVE MODE
// -----------------------------
document.getElementById('apply').addEventListener('click', () => {
  if (!countiesData?.features || !img.complete) return;

  // Hide visually but KEEP sampling
  canvas.style.opacity = 0;
  canvas.style.pointerEvents = "none";

  liveMode = true;

  startLiveUpdates();
});

// -----------------------------
// 9. LIVE UPDATE LOOP
// -----------------------------
function startLiveUpdates() {
  if (liveInterval) clearInterval(liveInterval);

  liveInterval = setInterval(() => {
    updateCountiesFromCanvas();
  }, 2000);
}

// -----------------------------
// 10. COLOR SAMPLING
// -----------------------------
function updateCountiesFromCanvas() {
  const canvasW = canvas.width;
  const canvasH = canvas.height;

  const pixelData = ctx.getImageData(0, 0, canvasW, canvasH).data;

  const data = JSON.parse(JSON.stringify(countiesData));

  data.features.forEach(feature => {
    const coords = getRepresentativeCoords(feature.geometry);
    if (!coords) return;

    const centroid = getCentroid(coords);

    let r = 0, g = 0, b = 0, count = 0;

    sampleOffsets.forEach(offset => {
      const point = map.project([
        centroid[0] + (offset[0] - 0.5) * 0.02,
        centroid[1] + (offset[1] - 0.5) * 0.02
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
    } else {
      feature.properties.color =
        `rgb(${Math.floor(r / count)}, ${Math.floor(g / count)}, ${Math.floor(b / count)})`;
    }
  });

  countiesData = data;
  map.getSource('counties').setData(data);
}

// -----------------------------
// 11. DOWNLOAD MAP IMAGE
// -----------------------------
document.getElementById('download').addEventListener('click', () => {
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'none';

  map.once('idle', () => {
    const link = document.createElement('a');
    link.download = 'county-map-art.png';
    link.href = map.getCanvas().toDataURL('image/png');
    link.click();

    overlay.style.display = 'block';
  });

  map.triggerRepaint();
});

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
  zoom: 4
});

// Ensure transparent background
map.on('load', () => {
  map.getCanvas().style.background = 'transparent';
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
  scale: 1
};

let isDragging = false;
let startX, startY;

let liveMode = false;
let liveInterval = null;

let useVideoSource = false;
const video = document.getElementById('webcamVideo');

const sampleOffsets = [
  [0.25, 0.25], [0.75, 0.25],
  [0.25, 0.75], [0.75, 0.75]
];

// -----------------------------
// 3. CANVAS RESIZE
// -----------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}

// -----------------------------
// 4. RENDER LOOP (image OR video)
// -----------------------------
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const source = useVideoSource ? video : img;
  const isReady = useVideoSource
    ? video.readyState >= 2
    : (img.complete && img.width);

  if (isReady) {
    const w = (useVideoSource ? video.videoWidth : img.width) * imgState.scale;
    const h = (useVideoSource ? video.videoHeight : img.height) * imgState.scale;

    ctx.drawImage(source, imgState.x, imgState.y, w, h);

    if (!liveMode) {
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(imgState.x, imgState.y, w, h);
    }
  }

  requestAnimationFrame(render);
}

// -----------------------------
// 5. INTERACTION
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
// 6. GEOMETRY HELPERS
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
// 7. MAP LOAD
// -----------------------------
map.on('load', async () => {
  const raw = await fetch('https://mapsmania.github.io/mappaintings/low.geojson').then(r => r.json());

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

map.on('resize', resizeCanvas);

// -----------------------------
// 8. APPLY LIVE MODE
// -----------------------------
document.getElementById('apply').addEventListener('click', () => {
  if (!countiesData?.features || !img.complete) return;

  canvas.style.opacity = 0;
  canvas.style.pointerEvents = "none";

  liveMode = true;
  startLiveUpdates();
});

// -----------------------------
// 9. START CAMERA
// -----------------------------
document.getElementById('startLive').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    useVideoSource = true;
    liveMode = true;

    video.onloadedmetadata = () => {
      canvas.style.opacity = 1;
      canvas.style.pointerEvents = "auto";

      imgState.scale = 1;
      imgState.x = (canvas.width / 2) - (video.videoWidth * imgState.scale / 2);
      imgState.y = (canvas.height / 2) - (video.videoHeight * imgState.scale / 2);
    };
  } catch (err) {
    console.error(err);
    alert("Camera blocked or not found.");
  }
});

// -----------------------------
// 10. LIVE UPDATE LOOP
// -----------------------------
function startLiveUpdates() {
  if (liveInterval) clearInterval(liveInterval);

  liveInterval = setInterval(() => {
    if (!map.isMoving() && !map.isZooming()) {
      updateCountiesFromCanvas();
    }
  }, 2000);
}

// -----------------------------
// 11. COLOR SAMPLING
// -----------------------------
function updateCountiesFromCanvas() {
  const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

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

      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;

      const i = (y * canvas.width + x) * 4;
      if (pixelData[i + 3] <= 1) return;

      r += pixelData[i];
      g += pixelData[i + 1];
      b += pixelData[i + 2];
      count++;
    });

    feature.properties.color = count === 0
      ? "#eeeeee"
      : `rgb(${Math.floor(r / count)}, ${Math.floor(g / count)}, ${Math.floor(b / count)})`;
  });

  countiesData = data;
  map.getSource('counties').setData(data);
}




document.getElementById('download').addEventListener('click', () => {
    if (!countiesData?.features?.length) return;

    // -----------------------------
    // 1. TRUE GEO BOUNDS (fixed)
    // -----------------------------
    const bounds = new maplibregl.LngLatBounds();

    countiesData.features.forEach(f => {
        const geom = f.geometry;
        if (!geom) return;

        if (geom.type === "Polygon") {
            geom.coordinates.forEach(ring => {
                ring.forEach(pt => bounds.extend(pt));
            });
        }

        if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach(poly => {
                poly.forEach(ring => {
                    ring.forEach(pt => bounds.extend(pt));
                });
            });
        }
    });

    // -----------------------------
    // 2. Create export map
    // -----------------------------
    const container = document.createElement('div');
    container.style.width = '3840px';
    container.style.height = '2160px';
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    document.body.appendChild(container);

    const renderMap = new maplibregl.Map({
        container,
        style: map.getStyle(),
        interactive: false,
        preserveDrawingBuffer: true,
        attributionControl: false
    });

    renderMap.on('load', () => {
        renderMap.setRenderWorldCopies(false);

        // -----------------------------
        // 3. CRITICAL: exact camera
        // -----------------------------
        renderMap.fitBounds(bounds, {
            padding: 0,
            animate: false
        });

        renderMap.once('idle', () => {

            const canvas = renderMap.getCanvas();

            // -----------------------------
            // 4. ONLY crop to canvas bounds (NOT pixel detection)
            // -----------------------------
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = canvas.width;
            cropCanvas.height = canvas.height;

            const ctx = cropCanvas.getContext('2d');
            ctx.drawImage(canvas, 0, 0);

            const link = document.createElement('a');
            link.download = 'map-export.png';
            link.href = cropCanvas.toDataURL('image/png');
            link.click();

            renderMap.remove();
            document.body.removeChild(container);
        });
    });
});

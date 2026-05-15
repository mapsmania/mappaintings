
// ================================
// BUILDING FOOTPRINT WEBCAM PAINTER
// MapLibre + Overpass + Canvas Sampling
// ================================

// --------------------------------
// 1. MAP SETUP
// --------------------------------
const map = new maplibregl.Map({
  container: 'map',
  preserveDrawingBuffer: true,
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#111'
        }
      }
    ]
  },
  center: [-73.9857, 40.7484], // NYC
  zoom: 16,
  pitch: 0,
  bearing: 0
});

// --------------------------------
// 2. GLOBALS
// --------------------------------
let buildingsData = null;

const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d', {
  willReadFrequently: true
});

const video = document.getElementById('webcamVideo');

let liveMode = false;
let useVideoSource = false;

let liveInterval = null;

// image/video placement
let imgState = {
  x: 100,
  y: 100,
  scale: 0.5
};

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// --------------------------------
// 3. RESIZE CANVAS
// --------------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}

map.on('resize', resizeCanvas);

// --------------------------------
// 4. MAIN RENDER LOOP
// --------------------------------
function renderOverlay() {

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (
    useVideoSource &&
    video.readyState >= 2
  ) {

    const w = video.videoWidth * imgState.scale;
    const h = video.videoHeight * imgState.scale;

    ctx.drawImage(
      video,
      imgState.x,
      imgState.y,
      w,
      h
    );

    // edit rectangle
    if (!liveMode) {

      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 2;

      ctx.strokeRect(
        imgState.x,
        imgState.y,
        w,
        h
      );
    }
  }

  requestAnimationFrame(renderOverlay);
}

// --------------------------------
// 5. INTERACTION
// --------------------------------
canvas.addEventListener('mousedown', (e) => {

  if (liveMode) return;

  isDragging = true;

  dragStartX = e.offsetX - imgState.x;
  dragStartY = e.offsetY - imgState.y;
});

window.addEventListener('mousemove', (e) => {

  if (!isDragging || liveMode) return;

  imgState.x = e.offsetX - dragStartX;
  imgState.y = e.offsetY - dragStartY;
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// zoom image
canvas.addEventListener('wheel', (e) => {

  if (liveMode) return;

  e.preventDefault();

  const delta = e.deltaY * -0.001;

  const oldScale = imgState.scale;

  imgState.scale = Math.min(
    Math.max(0.05, imgState.scale + delta),
    5
  );

  const scaleRatio = imgState.scale / oldScale;

  const mx = e.offsetX;
  const my = e.offsetY;

  imgState.x = mx - (mx - imgState.x) * scaleRatio;
  imgState.y = my - (my - imgState.y) * scaleRatio;

}, { passive: false });

// --------------------------------
// 6. OVERPASS → GEOJSON
// --------------------------------
function overpassToGeoJSON(data) {

  const features = [];

  data.elements.forEach(el => {

    if (
      el.type !== 'way' ||
      !el.geometry
    ) return;

    const coords = el.geometry.map(g => [
      g.lon,
      g.lat
    ]);

    if (coords.length < 3) return;

    // close polygon
    if (
      coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1]
    ) {
      coords.push(coords[0]);
    }

    features.push({
      type: 'Feature',
      properties: {
        id: el.id,
        color: '#999999'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      }
    });

  });

  return {
    type: 'FeatureCollection',
    features
  };
}

// --------------------------------
// 7. LOAD BUILDINGS
// --------------------------------
async function loadBuildings() {

  // avoid insane requests
  if (map.getZoom() < 15) return;

  const b = map.getBounds();

  const south = b.getSouth();
  const west = b.getWest();
  const north = b.getNorth();
  const east = b.getEast();

  const query = `
  [out:json][timeout:25];
  (
    way["building"](${south},${west},${north},${east});
  );
  out geom;
  `;

  console.log("Loading buildings...");

  const response = await fetch(
    'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      body: query
    }
  );

  const raw = await response.json();

  const geojson = overpassToGeoJSON(raw);

  buildingsData = geojson;

  if (map.getSource('buildings')) {

    map.getSource('buildings')
      .setData(buildingsData);

  } else {

    map.addSource('buildings', {
      type: 'geojson',
      data: buildingsData
    });

    map.addLayer({
      id: 'buildings-fill',
      type: 'fill',
      source: 'buildings',
      paint: {
        'fill-color': [
          'coalesce',
          ['get', 'color'],
          '#888'
        ],
        'fill-opacity': 0.95
      }
    });

    map.addLayer({
      id: 'buildings-outline',
      type: 'line',
      source: 'buildings',
      paint: {
        'line-color': '#000',
        'line-width': 1
      }
    });
  }

  console.log(
    `Loaded ${geojson.features.length} buildings`
  );
}

// --------------------------------
// 8. GEOMETRY HELPERS
// --------------------------------
function getPolygonCentroid(coords) {

  let x = 0;
  let y = 0;

  coords.forEach(c => {
    x += c[0];
    y += c[1];
  });

  return [
    x / coords.length,
    y / coords.length
  ];
}

// --------------------------------
// 9. COLOR SAMPLING
// --------------------------------
function updateBuildingsFromCanvas() {

  if (!buildingsData) return;

  const pixelData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  ).data;

  const updated = JSON.parse(
    JSON.stringify(buildingsData)
  );

  updated.features.forEach(feature => {

    const coords =
      feature.geometry.coordinates[0];

    if (!coords?.length) return;

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    // --------------------------------
    // SAMPLE CENTROID
    // --------------------------------
    const centroid =
      getPolygonCentroid(coords);

    const p = map.project(centroid);

    samplePixel(p.x, p.y);

    // --------------------------------
    // SAMPLE VERTICES
    // --------------------------------
    coords.forEach(coord => {

      const pt = map.project(coord);

      samplePixel(pt.x, pt.y);
    });

    function samplePixel(px, py) {

      const x = Math.floor(px);
      const y = Math.floor(py);

      if (
        x < 0 ||
        y < 0 ||
        x >= canvas.width ||
        y >= canvas.height
      ) return;

      const i =
        (y * canvas.width + x) * 4;

      const alpha = pixelData[i + 3];

      if (alpha < 10) return;

      r += pixelData[i];
      g += pixelData[i + 1];
      b += pixelData[i + 2];

      count++;
    }

    feature.properties.color =
      count === 0
        ? '#444444'
        : `rgb(
            ${Math.floor(r / count)},
            ${Math.floor(g / count)},
            ${Math.floor(b / count)}
          )`;

  });

  buildingsData = updated;

  map.getSource('buildings')
    .setData(buildingsData);
}

// --------------------------------
// 10. LIVE UPDATE LOOP
// --------------------------------
function startLiveUpdates() {

  if (liveInterval) {
    clearInterval(liveInterval);
  }

  liveInterval = setInterval(() => {

    if (
      map.isMoving() ||
      map.isZooming()
    ) return;

    updateBuildingsFromCanvas();

  }, 1000);
}

// --------------------------------
// 11. START WEBCAM
// --------------------------------
document
  .getElementById('startLive')
  .addEventListener('click', async () => {

    try {

      const stream =
        await navigator.mediaDevices
          .getUserMedia({
            video: true
          });

      video.srcObject = stream;

      useVideoSource = true;

      video.onloadedmetadata = () => {

  // --------------------------------
  // MAP SIZE
  // --------------------------------
  const mapW = canvas.width;
  const mapH = canvas.height;

  // --------------------------------
  // VIDEO SIZE
  // --------------------------------
  const vidW = video.videoWidth;
  const vidH = video.videoHeight;

  // --------------------------------
  // SCALE VIDEO TO ~95% OF MAP
  // --------------------------------
  const scaleX = (mapW * 0.95) / vidW;
  const scaleY = (mapH * 0.95) / vidH;

  // preserve aspect ratio
  imgState.scale = Math.max(scaleX, scaleY);

  // --------------------------------
  // FINAL SIZE
  // --------------------------------
  const finalW = vidW * imgState.scale;
  const finalH = vidH * imgState.scale;

  // --------------------------------
  // CENTER VIDEO
  // --------------------------------
  imgState.x = (mapW - finalW) / 2;
  imgState.y = (mapH - finalH) / 2;

  console.log(
    `Webcam scaled to ${Math.round(finalW)}x${Math.round(finalH)}`
  );
};

    } catch (err) {

      console.error(err);

      alert(
        'Camera access denied or unavailable.'
      );
    }
  });

// --------------------------------
// 12. APPLY LIVE PAINTING
// --------------------------------

document
  .getElementById('apply')
  .addEventListener('click', () => {

    // ensure webcam exists
    if (
      !useVideoSource ||
      video.readyState < 2
    ) {
      alert("Start the webcam first.");
      return;
    }

    // --------------------------------
    // 1. SAMPLE CURRENT FRAME
    // --------------------------------
    updateBuildingsFromCanvas();

    // --------------------------------
    // 2. HIDE WEBCAM OVERLAY
    // --------------------------------
    canvas.style.opacity = 0;
    canvas.style.pointerEvents = 'none';

    // --------------------------------
    // 3. STOP LIVE MODE
    // --------------------------------
    liveMode = false;

    if (liveInterval) {
      clearInterval(liveInterval);
      liveInterval = null;
    }

    console.log("Applied webcam colors to buildings.");
  });

// --------------------------------
// 13. STOP LIVE MODE
// --------------------------------
document
  .getElementById('stop')
  ?.addEventListener('click', () => {

    liveMode = false;

    canvas.style.pointerEvents = 'auto';

    if (liveInterval) {
      clearInterval(liveInterval);
    }
  });

// --------------------------------
// 14. EXPORT PNG
// --------------------------------
document
  .getElementById('download')
  .addEventListener('click', () => {

    const exportCanvas = map.getCanvas();

    const link = document.createElement('a');

    link.download = 'building-paint-map.png';

    link.href =
      exportCanvas.toDataURL('image/png');

    link.click();
  });

// --------------------------------
// 15. INITIALIZATION
// --------------------------------
map.on('load', async () => {

  map.getCanvas().style.background =
    'transparent';

  resizeCanvas();

  renderOverlay();

  await loadBuildings();
});

// reload buildings after move
map.on('moveend', async () => {

  await loadBuildings();
});


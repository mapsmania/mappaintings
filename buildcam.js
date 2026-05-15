// ================================
// LIVE URBAN SCREEN
// Webcam → Building Footprints
// MapLibre + Overpass + Canvas Sampling
// ================================

const PIXEL_GRID_SIZE = 120;

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
          'background-color': '#050505'
        }
      }
    ]
  },

  center: [-73.9857, 40.7484],
  zoom: 13.5,
  pitch: 0,
  bearing: 0
});

// --------------------------------
// 2. GLOBALS
// --------------------------------
let buildingsData = null;

const canvas =
  document.getElementById('overlay');

const ctx = canvas.getContext('2d', {
  willReadFrequently: true
});

const sampleCanvas =
  document.createElement('canvas');

const sampleCtx =
  sampleCanvas.getContext('2d');

sampleCanvas.width =
  PIXEL_GRID_SIZE;

sampleCanvas.height =
  PIXEL_GRID_SIZE;

const video =
  document.getElementById('webcamVideo');

let useVideoSource = false;

let liveMode = false;

let liveInterval = null;

// webcam placement
let imgState = {
  x: 100,
  y: 100,
  scale: 1
};

// dragging
let isDragging = false;

let dragStartX = 0;
let dragStartY = 0;

// --------------------------------
// 3. RESIZE CANVAS
// --------------------------------
function resizeCanvas() {

  canvas.width =
    map.getCanvas().width;

  canvas.height =
    map.getCanvas().height;
}

map.on('resize', resizeCanvas);

// --------------------------------
// 4. RENDER OVERLAY
// --------------------------------
function renderOverlay() {

  // only visible during editing
  if (!liveMode) {

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    if (
      useVideoSource &&
      video.readyState >= 2
    ) {

      const w =
        video.videoWidth *
        imgState.scale;

      const h =
        video.videoHeight *
        imgState.scale;

      ctx.drawImage(
        video,
        imgState.x,
        imgState.y,
        w,
        h
      );

      // editor outline
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
canvas.addEventListener(
  'mousedown',
  (e) => {

    if (liveMode) return;

    isDragging = true;

    dragStartX =
      e.offsetX - imgState.x;

    dragStartY =
      e.offsetY - imgState.y;
  }
);

window.addEventListener(
  'mousemove',
  (e) => {

    if (!isDragging || liveMode)
      return;

    imgState.x =
      e.offsetX - dragStartX;

    imgState.y =
      e.offsetY - dragStartY;
  }
);

window.addEventListener(
  'mouseup',
  () => {
    isDragging = false;
  }
);

// zoom webcam
canvas.addEventListener(
  'wheel',
  (e) => {

    if (liveMode) return;

    e.preventDefault();

    const delta =
      e.deltaY * -0.001;

    const oldScale =
      imgState.scale;

    imgState.scale = Math.min(
      Math.max(
        0.05,
        imgState.scale + delta
      ),
      8
    );

    const ratio =
      imgState.scale / oldScale;

    const mx = e.offsetX;
    const my = e.offsetY;

    imgState.x =
      mx - (mx - imgState.x) * ratio;

    imgState.y =
      my - (my - imgState.y) * ratio;

  },
  { passive: false }
);

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

    const coords =
      el.geometry.map(g => [
        g.lon,
        g.lat
      ]);

    if (coords.length < 3)
      return;

    // close polygon
    if (
      coords[0][0] !==
        coords[coords.length - 1][0] ||
      coords[0][1] !==
        coords[coords.length - 1][1]
    ) {
      coords.push(coords[0]);
    }

    features.push({
      type: 'Feature',

      properties: {
        id: el.id,
        color: '#111111'
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

  if (map.getZoom() < 13)
    return;

  const b = map.getBounds();

  const south = b.getSouth();
  const west = b.getWest();
  const north = b.getNorth();
  const east = b.getEast();

  const query = `
  [out:json][timeout:25];
  (
    way["building"]
    (${south},${west},${north},${east});
  );
  out geom;
  `;

  console.log(
    'Loading buildings...'
  );

  const response = await fetch(
    'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      body: query
    }
  );

  const raw =
    await response.json();

  buildingsData =
    overpassToGeoJSON(raw);

  if (
    map.getSource('buildings')
  ) {

    map
      .getSource('buildings')
      .setData(buildingsData);

  } else {

    map.addSource(
      'buildings',
      {
        type: 'geojson',
        data: buildingsData
      }
    );

    map.addLayer({
      id: 'buildings-fill',

      type: 'fill',

      source: 'buildings',

      paint: {

        'fill-color': [
          'coalesce',
          ['get', 'color'],
          '#111'
        ],

        'fill-opacity': 1,

        'fill-antialias': false
      }
    });

    
  }

  console.log(
    `Loaded ${buildingsData.features.length} buildings`
  );
}

// --------------------------------
// 8. TRUE POLYGON CENTROID
// --------------------------------
function getCentroid(coords) {

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (
    let i = 0;
    i < coords.length - 1;
    i++
  ) {

    const x1 = coords[i][0];
    const y1 = coords[i][1];

    const x2 = coords[i + 1][0];
    const y2 = coords[i + 1][1];

    const f =
      (x1 * y2) -
      (x2 * y1);

    area += f;

    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }

  area *= 0.5;

  if (Math.abs(area) < 1e-7) {

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

  cx /= (6 * area);
  cy /= (6 * area);

  return [cx, cy];
}

// --------------------------------
// 9. SAMPLE BUILDING COLORS
// --------------------------------
function updateBuildingsFromCanvas() {

  if (!buildingsData) return;

  // --------------------------------
  // DRAW LOW-RES WEBCAM
  // --------------------------------
  sampleCtx.clearRect(
    0,
    0,
    PIXEL_GRID_SIZE,
    PIXEL_GRID_SIZE
  );

  sampleCtx.drawImage(
    canvas,
    0,
    0,
    PIXEL_GRID_SIZE,
    PIXEL_GRID_SIZE
  );

  const pixelData =
    sampleCtx.getImageData(
      0,
      0,
      PIXEL_GRID_SIZE,
      PIXEL_GRID_SIZE
    ).data;

  for (const feature of buildingsData.features) {

    const coords =
      feature.geometry.coordinates[0];

    if (!coords?.length)
      continue;

    // --------------------------------
    // BUILDING CENTROID
    // --------------------------------
    const centroid =
      getCentroid(coords);

    const p =
      map.project(centroid);

    // --------------------------------
    // MAP SCREEN → LOW RES GRID
    // --------------------------------
    const gx = Math.floor(
      (p.x / canvas.width) *
      PIXEL_GRID_SIZE
    );

    const gy = Math.floor(
      (p.y / canvas.height) *
      PIXEL_GRID_SIZE
    );

    if (
      gx < 0 ||
      gy < 0 ||
      gx >= PIXEL_GRID_SIZE ||
      gy >= PIXEL_GRID_SIZE
    ) continue;

    const i =
      (gy * PIXEL_GRID_SIZE + gx) * 4;

    feature.properties.color =
      `rgb(
        ${pixelData[i]},
        ${pixelData[i + 1]},
        ${pixelData[i + 2]}
      )`;
  }

  map
    .getSource('buildings')
    .setData(buildingsData);
}

// --------------------------------
// 10. LIVE URBAN SCREEN LOOP
// --------------------------------
function startLiveUpdates() {

  if (liveInterval) {
    clearInterval(liveInterval);
  }

  liveInterval = setInterval(() => {

    if (
      !useVideoSource ||
      video.readyState < 2
    ) return;

    // draw hidden webcam frame
    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const w =
      video.videoWidth *
      imgState.scale;

    const h =
      video.videoHeight *
      imgState.scale;

    ctx.drawImage(
      video,
      imgState.x,
      imgState.y,
      w,
      h
    );

    // repaint buildings
    updateBuildingsFromCanvas();

  }, 100);
}

// --------------------------------
// 11. START WEBCAM
// --------------------------------
document
  .getElementById('startLive')
  .addEventListener(
    'click',
    async () => {

      try {

        const stream =
          await navigator
            .mediaDevices
            .getUserMedia({
              video: true
            });

        video.srcObject =
          stream;

        useVideoSource = true;

        video.onloadedmetadata =
          () => {

            const mapW =
              canvas.width;

            const mapH =
              canvas.height;

            const vidW =
              video.videoWidth;

            const vidH =
              video.videoHeight;

            const scaleX =
              (mapW * 0.95) / vidW;

            const scaleY =
              (mapH * 0.95) / vidH;

            imgState.scale =
              Math.max(
                scaleX,
                scaleY
              );

            const finalW =
              vidW *
              imgState.scale;

            const finalH =
              vidH *
              imgState.scale;

            imgState.x =
              (mapW - finalW) / 2;

            imgState.y =
              (mapH - finalH) / 2;

            console.log(
              'Webcam ready'
            );
          };

      } catch (err) {

        console.error(err);

        alert(
          'Camera unavailable.'
        );
      }
    }
  );

// --------------------------------
// 12. APPLY LIVE MODE
// --------------------------------
document
  .getElementById('apply')
  .addEventListener(
    'click',
    () => {

      if (
        !useVideoSource ||
        video.readyState < 2
      ) {
        alert(
          'Start webcam first.'
        );

        return;
      }

      // hide overlay visually
      canvas.style.opacity = 0;

      canvas.style.pointerEvents =
        'none';

      liveMode = true;

      // start urban screen
      startLiveUpdates();

      console.log(
        'Urban screen mode enabled.'
      );
    }
  );

// --------------------------------
// 13. STOP LIVE MODE
// --------------------------------
document
  .getElementById('stop')
  ?.addEventListener(
    'click',
    () => {

      liveMode = false;

      if (liveInterval) {

        clearInterval(
          liveInterval
        );

        liveInterval = null;
      }

      // show webcam editor again
      canvas.style.opacity = 1;

      canvas.style.pointerEvents =
        'auto';
    }
  );

// --------------------------------
// 14. EXPORT PNG
// --------------------------------
document
  .getElementById('download')
  .addEventListener(
    'click',
    () => {

      const exportCanvas =
        map.getCanvas();

      const link =
        document.createElement('a');

      link.download =
        'urban-screen.png';

      link.href =
        exportCanvas.toDataURL(
          'image/png'
        );

      link.click();
    }
  );

// --------------------------------
// 15. INITIALIZE
// --------------------------------
map.on(
  'load',
  async () => {

    map.getCanvas().style.background =
      'transparent';

    resizeCanvas();

    renderOverlay();

    await loadBuildings();
  }
);

// reload buildings after move
map.on(
  'moveend',
  async () => {

    await loadBuildings();
  }
);

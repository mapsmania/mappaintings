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
// MAP INIT
// -----------------------------
map.on('load', async () => {

  // Load GeoJSON safely (we store it ourselves too)
  countiesData = await fetch('combined_counties.geojson')
    .then(r => r.json());

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
// CANVAS + IMAGE SETUP
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
// RESIZE HANDLING
// -----------------------------
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
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

    img.onload = () => {
      render();
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
});

// -----------------------------
// RENDER IMAGE ON CANVAS
// -----------------------------
function render() {
  if (!img || !img.complete || !img.width) return;

  const w = img.width * imgState.scale;
  const h = img.height * imgState.scale;

  imgState.x = canvas.width / 2 - w / 2;
  imgState.y = canvas.height / 2 - h / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, imgState.x, imgState.y, w, h);
}

// -----------------------------
// PIXEL SAMPLING
// -----------------------------
function getPixelColor(x, y) {
  const data = ctx.getImageData(x, y, 1, 1).data;

  if (!data || data.length < 3) return null;

  return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
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

  if (!img || !img.complete) {
    alert("Image not loaded yet");
    return;
  }

  const source = map.getSource('counties');

  // work on a copy (avoid MapLibre internal mutation issues)
  const data = JSON.parse(JSON.stringify(countiesData));

  data.features.forEach(feature => {

    const coords = getRepresentativeCoords(feature.geometry);
    if (!coords) return;

    const centroidLngLat = getCentroid(coords);
    const point = map.project(centroidLngLat);

    const x = Math.floor(point.x);
    const y = Math.floor(point.y);

    const w = img.width * imgState.scale;
    const h = img.height * imgState.scale;

    const localX = x - imgState.x;
    const localY = y - imgState.y;

    if (
      localX < 0 || localY < 0 ||
      localX >= w || localY >= h
    ) return;

    const color = getPixelColor(localX, localY);

    // fallback to avoid MapLibre null error
    feature.properties.color = color || "rgb(200,200,200)";
  });

  countiesData = data;
  source.setData(data);
});

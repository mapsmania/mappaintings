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

const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

let img = new Image();

// match canvas to map size
function resizeCanvas() {
  canvas.width = map.getCanvas().width;
  canvas.height = map.getCanvas().height;
}
map.on('resize', resizeCanvas);
map.on('load', resizeCanvas);

document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    img.onload = drawImage;
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

let imgState = {
  x: 0,
  y: 0,
  scale: 0.5
};

function drawImage() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = img.width * imgState.scale;
  const h = img.height * imgState.scale;

  imgState.x = canvas.width / 2 - w / 2;
  imgState.y = canvas.height / 2 - h / 2;

  ctx.drawImage(img, imgState.x, imgState.y, w, h);
}

function getPixelColor(x, y) {
  const data = ctx.getImageData(x, y, 1, 1).data;
  return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
}

function getCentroid(coords) {
  let x = 0, y = 0;

  coords.forEach(c => {
    x += c[0];
    y += c[1];
  });

  return [x / coords.length, y / coords.length];
}

document.getElementById('apply').addEventListener('click', () => {

  const source = map.getSource('counties');
  const data = source._data;

  data.features.forEach(feature => {

    const geom = feature.geometry;

    const coords = getRepresentativeCoords(geom);
    if (!coords) return;

    const centroidLngLat = getCentroid(coords);
    const point = map.project(centroidLngLat);

    const x = Math.floor(point.x);
    const y = Math.floor(point.y);

    const localX = x - imgState.x;
    const localY = y - imgState.y;

    const w = img.width * imgState.scale;
    const h = img.height * imgState.scale;

    if (
      localX < 0 || localY < 0 ||
      localX >= w || localY >= h
    ) return;

    const color = getPixelColor(localX, localY);

    feature.properties.color = color;
  });

  source.setData(data);
});

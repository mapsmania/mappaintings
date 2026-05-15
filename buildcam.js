function getCentroid(coords) {

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < coords.length - 1; i++) {

    const x1 = coords[i][0];
    const y1 = coords[i][1];

    const x2 = coords[i + 1][0];
    const y2 = coords[i + 1][1];

    const f = (x1 * y2) - (x2 * y1);

    area += f;

    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }

  area *= 0.5;

  // fallback for invalid polygons
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

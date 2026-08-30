function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseCoordinates(latitude, longitude) {
  if (isBlank(latitude) && isBlank(longitude)) return { coordinates: null };
  if (isBlank(latitude) || isBlank(longitude)) return { error: 'Latitude e longitude devem ser informadas juntas.' };

  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude) || parsedLatitude < -90 || parsedLatitude > 90 || parsedLongitude < -180 || parsedLongitude > 180) {
    return { error: 'Coordenadas geográficas inválidas.' };
  }
  return { coordinates: { latitude: parsedLatitude, longitude: parsedLongitude } };
}

module.exports = { parseCoordinates };

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PHOTO_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

function hasExpectedSignature(photo) {
  const data = photo.data;
  if (photo.contentType === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (photo.contentType === 'image/png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (photo.contentType === 'image/webp') return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

class PhotoStorage {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  validate(photo) {
    if (!photo) return null;
    const extension = PHOTO_TYPES.get(photo.contentType);
    if (!extension) throw new Error('As fotos devem estar nos formatos JPG, PNG ou WebP.');
    const originalExtension = path.extname(String(photo.filename || '')).toLowerCase();
    if (originalExtension && originalExtension !== extension && !(photo.contentType === 'image/jpeg' && originalExtension === '.jpeg')) {
      throw new Error('A extensão do arquivo não corresponde ao tipo de imagem enviado.');
    }
    if (!photo.data?.length || photo.data.length > MAX_PHOTO_SIZE) throw new Error('Cada foto deve ter no máximo 5 MB.');
    if (!hasExpectedSignature(photo)) throw new Error('O conteúdo do arquivo não corresponde a uma imagem válida.');
    return extension;
  }

  save(photo) {
    const extension = this.validate(photo);
    if (!extension) return null;
    const filename = `${randomUUID()}${extension}`;
    fs.writeFileSync(path.join(this.directory, filename), photo.data, { flag: 'wx' });
    return {
      storagePath: `uploads/${filename}`,
      originalName: path.basename(String(photo.filename || 'imagem')).slice(0, 180),
      mimeType: photo.contentType,
      size: photo.data.length,
    };
  }

  remove(photo) {
    const relativePath = typeof photo === 'string' ? photo : photo?.storagePath;
    if (!relativePath) return;
    const filename = path.basename(relativePath);
    fs.rmSync(path.join(this.directory, filename), { force: true });
  }
}

module.exports = { PhotoStorage };

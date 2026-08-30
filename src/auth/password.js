const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const KEY_LENGTH = 64;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'A senha deve ter pelo menos 12 caracteres.';
  }
  return null;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

function verifyPassword(password, storedValue) {
  const [algorithm, saltValue, hashValue] = String(storedValue).split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;

  const expected = Buffer.from(hashValue, 'base64');
  const actual = scryptSync(password, Buffer.from(saltValue, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, validatePassword, verifyPassword };

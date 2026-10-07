'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv'
]);
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.ps1', '.php', '.phtml', '.js', '.mjs', '.vbs', '.jar', '.com', '.scr']);

function numberEnv(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

function mediaLimits() {
  return {
    image: numberEnv('MEDIA_MAX_IMAGE_MB', 15, 1, 100) * 1024 * 1024,
    video: numberEnv('MEDIA_MAX_VIDEO_MB', 500, 1, 5000) * 1024 * 1024,
    document: numberEnv('MEDIA_MAX_DOCUMENT_MB', 50, 1, 500) * 1024 * 1024,
    other: numberEnv('MEDIA_MAX_DOCUMENT_MB', 50, 1, 500) * 1024 * 1024,
    backend: numberEnv('MEDIA_BACKEND_UPLOAD_MAX_MB', 20, 1, 200) * 1024 * 1024
  };
}

function cleanMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function extensionFromName(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ext && ext.length <= 12 ? ext : '';
}

function classifyMedia(mimeType, filename = '') {
  const mime = cleanMime(mimeType);
  const ext = extensionFromName(filename);
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    const error = new Error('Executable files are not allowed.');
    error.code = 'FILE_TYPE_NOT_ALLOWED';
    error.status = 400;
    throw error;
  }
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  if (DOCUMENT_MIME.has(mime) || ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'].includes(ext)) return 'document';
  return 'other';
}

function validateUpload({ filename, mimeType, size }) {
  const mediaType = classifyMedia(mimeType, filename);
  const limits = mediaLimits();
  const max = limits[mediaType] || limits.other;
  if (Number(size || 0) > max) {
    const error = new Error(`${mediaType[0].toUpperCase()}${mediaType.slice(1)} exceeds the maximum allowed size.`);
    error.code = 'FILE_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  return { mediaType, maxBytes: max };
}

function slugifyFilename(filename) {
  const original = String(filename || 'asset').replace(/\\/g, '/').split('/').pop() || 'asset';
  const ext = extensionFromName(original);
  const base = (ext ? original.slice(0, -ext.length) : original)
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 90) || 'asset';
  return `${base}${ext}`;
}

function folderForMedia(mediaType) {
  if (mediaType === 'image') return 'images';
  if (mediaType === 'video') return 'videos';
  if (mediaType === 'document') return 'documents';
  return 'other';
}

function createObjectKey({ filename, mimeType, now = new Date() }) {
  const mediaType = classifyMedia(mimeType, filename);
  const safeName = slugifyFilename(filename);
  const ext = extensionFromName(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const suffix = crypto.randomBytes(3).toString('hex');
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return {
    mediaType,
    fileName: `${base}-${suffix}${ext}`,
    objectKey: `${folderForMedia(mediaType)}/${year}/${month}/${base}-${suffix}${ext}`,
    extension: ext ? ext.slice(1) : ''
  };
}

function safeFolder(value) {
  return String(value || '').replace(/[^\p{L}\p{M}\p{N}\s._/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

module.exports = {
  cleanMime,
  classifyMedia,
  createObjectKey,
  extensionFromName,
  mediaLimits,
  safeFolder,
  slugifyFilename,
  validateUpload
};

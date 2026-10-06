'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client = null;
let clientKey = '';

function storageConfig() {
  const r2AccountId = process.env.R2_ACCOUNT_ID || '';
  const endpoint = process.env.S3_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');
  const driver = String(process.env.STORAGE_DRIVER || (endpoint ? 's3' : 'local')).trim().toLowerCase();
  return {
    driver,
    endpoint,
    region: process.env.S3_REGION || (r2AccountId ? 'auto' : 'us-east-1'),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME || '',
    publicBaseUrl: String(process.env.S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    forcePathStyle: ['1', 'true', 'yes'].includes(String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase()),
    localMediaDir: process.env.LOCAL_MEDIA_DIR || 'uploads',
    localPublicBaseUrl: String(process.env.LOCAL_MEDIA_PUBLIC_BASE_URL || '/media').replace(/\/+$/, '')
  };
}

function storageConfigured() {
  const config = storageConfig();
  if (config.driver === 'local') return true;
  return Boolean(config.endpoint && config.accessKeyId && config.secretAccessKey && config.bucket && config.publicBaseUrl);
}

function requireStorageConfigured() {
  if (!storageConfigured()) {
    const error = new Error('Media storage is not configured.');
    error.status = 503;
    error.code = 'MEDIA_STORAGE_NOT_CONFIGURED';
    throw error;
  }
}

function storageClient() {
  requireStorageConfigured();
  const config = storageConfig();
  if (config.driver === 'local') {
    const error = new Error('Local media storage does not use an S3 client.');
    error.status = 400;
    error.code = 'LOCAL_STORAGE_ONLY';
    throw error;
  }
  const nextKey = `${config.endpoint}|${config.region}|${config.accessKeyId}|${config.bucket}|${config.forcePathStyle}`;
  if (client && clientKey === nextKey) return client;
  clientKey = nextKey;
  client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return client;
}

function createPublicUrl(objectKey) {
  const config = storageConfig();
  if (config.driver === 'local') return `${config.localPublicBaseUrl}/${String(objectKey || '').replace(/^\/+/, '')}`;
  return `${config.publicBaseUrl}/${String(objectKey || '').replace(/^\/+/, '')}`;
}

async function uploadObject({ key, body, contentType, cacheControl = 'public, max-age=31536000, immutable' }) {
  const config = storageConfig();
  if (config.driver === 'local') {
    const type = String(contentType || '').toLowerCase();
    if (!type.startsWith('image/') && !type.startsWith('video/')) {
      const error = new Error('Local storage mode currently supports images and videos only.');
      error.status = 400;
      error.code = 'LOCAL_MEDIA_TYPES_ONLY';
      throw error;
    }
    const root = path.resolve(process.cwd(), config.localMediaDir);
    const filePath = path.resolve(root, String(key || '').replace(/^[/\\]+/, ''));
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      const error = new Error('Invalid local media path.');
      error.status = 400;
      error.code = 'INVALID_MEDIA_PATH';
      throw error;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return createPublicUrl(key);
  }
  await storageClient().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: cacheControl
  }));
  return createPublicUrl(key);
}

async function deleteObject(key) {
  const config = storageConfig();
  if (config.driver === 'local') {
    const root = path.resolve(process.cwd(), config.localMediaDir);
    const filePath = path.resolve(root, String(key || '').replace(/^[/\\]+/, ''));
    if (filePath !== root && filePath.startsWith(`${root}${path.sep}`)) {
      await fs.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return;
  }
  await storageClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function headObject(key) {
  const config = storageConfig();
  if (config.driver === 'local') {
    const root = path.resolve(process.cwd(), config.localMediaDir);
    const filePath = path.resolve(root, String(key || '').replace(/^[/\\]+/, ''));
    if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) {
      const error = new Error('Invalid local media path.');
      error.status = 400;
      error.code = 'INVALID_MEDIA_PATH';
      throw error;
    }
    const stat = await fs.stat(filePath);
    return { ContentLength: stat.size, LastModified: stat.mtime };
  }
  return storageClient().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function createPresignedUploadUrl({ key, contentType, expiresIn = 900 }) {
  const config = storageConfig();
  if (config.driver === 'local') {
    const error = new Error('Direct upload URLs are not available in local media mode.');
    error.status = 400;
    error.code = 'PRESIGNED_UPLOAD_UNAVAILABLE';
    throw error;
  }
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable'
  });
  return getSignedUrl(storageClient(), command, { expiresIn });
}

module.exports = {
  createPresignedUploadUrl,
  createPublicUrl,
  deleteObject,
  headObject,
  r2Configured: storageConfigured,
  requireR2Configured: requireStorageConfigured,
  requireStorageConfigured,
  storageConfig,
  storageConfigured,
  uploadObject
};

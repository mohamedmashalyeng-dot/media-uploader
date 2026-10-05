'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client = null;
let clientKey = '';

function storageConfig() {
  const r2AccountId = process.env.R2_ACCOUNT_ID || '';
  const endpoint = process.env.S3_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');
  return {
    endpoint,
    region: process.env.S3_REGION || (r2AccountId ? 'auto' : 'us-east-1'),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME || '',
    publicBaseUrl: String(process.env.S3_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    forcePathStyle: ['1', 'true', 'yes'].includes(String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase())
  };
}

function storageConfigured() {
  const config = storageConfig();
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
  return `${config.publicBaseUrl}/${String(objectKey || '').replace(/^\/+/, '')}`;
}

async function uploadObject({ key, body, contentType, cacheControl = 'public, max-age=31536000, immutable' }) {
  const config = storageConfig();
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
  await storageClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function headObject(key) {
  const config = storageConfig();
  return storageClient().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function createPresignedUploadUrl({ key, contentType, expiresIn = 900 }) {
  const config = storageConfig();
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

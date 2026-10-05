'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client = null;

function r2Config() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET_NAME || '',
    publicBaseUrl: String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  };
}

function r2Configured() {
  const config = r2Config();
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket && config.publicBaseUrl);
}

function requireR2Configured() {
  if (!r2Configured()) {
    const error = new Error('Cloudflare R2 storage is not configured.');
    error.status = 503;
    error.code = 'MEDIA_STORAGE_NOT_CONFIGURED';
    throw error;
  }
}

function r2Client() {
  requireR2Configured();
  if (client) return client;
  const config = r2Config();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return client;
}

function createPublicUrl(objectKey) {
  const config = r2Config();
  return `${config.publicBaseUrl}/${String(objectKey || '').replace(/^\/+/, '')}`;
}

async function uploadObject({ key, body, contentType, cacheControl = 'public, max-age=31536000, immutable' }) {
  const config = r2Config();
  await r2Client().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: cacheControl
  }));
  return createPublicUrl(key);
}

async function deleteObject(key) {
  const config = r2Config();
  await r2Client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function headObject(key) {
  const config = r2Config();
  return r2Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function createPresignedUploadUrl({ key, contentType, expiresIn = 900 }) {
  const config = r2Config();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable'
  });
  return getSignedUrl(r2Client(), command, { expiresIn });
}

module.exports = {
  createPresignedUploadUrl,
  createPublicUrl,
  deleteObject,
  headObject,
  r2Configured,
  requireR2Configured,
  uploadObject
};

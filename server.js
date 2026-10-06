'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const Busboy = require('busboy');
const { Pool } = require('pg');
const {
  createPresignedUploadUrl,
  createPublicUrl,
  deleteObject,
  headObject,
  storageConfig,
  storageConfigured,
  uploadObject
} = require('./lib/object-storage');
const {
  cleanMime,
  createObjectKey,
  mediaLimits,
  safeFolder,
  validateUpload
} = require('./lib/media-utils');

const ROOT = __dirname;
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrator';
const sessions = new Map();
let pool = null;

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function statusError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function getPool() {
  if (!process.env.DATABASE_URL) throw statusError(503, 'Neon PostgreSQL is not configured.', 'DATABASE_NOT_CONFIGURED');
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=require/i.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined
  });
  pool.on('error', error => console.error(`[postgres] ${error.message || error}`));
  return pool;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function configuredAuth() {
  return Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index).trim()), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function sessionCookie(req, sid, maxAge = SESSION_TTL_MS / 1000) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwardedProto === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function createSession() {
  const sid = crypto.randomBytes(32).toString('base64url');
  const user = { id: 'admin', name: ADMIN_NAME, email: ADMIN_EMAIL, role: 'admin' };
  sessions.set(sid, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return { sid, user };
}

function currentUser(req) {
  if (!configuredAuth()) throw statusError(503, 'Admin login is not configured.', 'AUTH_NOT_CONFIGURED');
  const sid = parseCookies(req).sid;
  const session = sid ? sessions.get(sid) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (sid) sessions.delete(sid);
    throw statusError(401, 'Sign in to continue.', 'UNAUTHENTICATED');
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.user;
}

function canManageMedia(user) {
  return ['admin', 'manager', 'staff'].includes(String(user?.role || '').toLowerCase());
}

function readJson(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) reject(statusError(413, 'Request body is too large.', 'REQUEST_TOO_LARGE'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(statusError(400, 'Invalid JSON body.', 'INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(req, res, value, status = 200, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendError(req, res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error(`[api] ${req.method} ${req.url}: ${error.stack || error.message || error}`);
  sendJson(req, res, {
    ok: false,
    error: error.code || (status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED'),
    message: error.message || 'Server error.'
  }, status);
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64urlJson(value, label) {
  try { return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8')); }
  catch { throw statusError(400, `Invalid ${label}.`, `INVALID_${label.toUpperCase()}`); }
}

function signUpload(payload) {
  const data = base64urlJson(payload);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyUploadToken(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) throw statusError(400, 'Upload token is invalid.', 'INVALID_UPLOAD_TOKEN');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw statusError(400, 'Upload token is invalid.', 'INVALID_UPLOAD_TOKEN');
  }
  const payload = parseBase64urlJson(data, 'upload token');
  if (Number(payload.exp || 0) < Date.now()) throw statusError(400, 'Upload token has expired.', 'UPLOAD_TOKEN_EXPIRED');
  return payload;
}

function mediaRow(row) {
  return {
    id: row.id,
    file_name: row.file_name,
    original_file_name: row.original_file_name,
    object_key: row.object_key,
    public_url: row.public_url,
    url: row.public_url,
    media_type: row.media_type,
    mime_type: row.mime_type,
    extension: row.extension,
    size_bytes: Number(row.size_bytes || 0),
    title: row.title || '',
    alt_text: row.alt_text || '',
    caption: row.caption || '',
    description: row.description || '',
    folder: row.folder || '',
    width: row.width,
    height: row.height,
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    uploaded_by: row.uploaded_by || '',
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mediaSummary(row) {
  const item = mediaRow(row);
  delete item.object_key;
  delete item.description;
  return item;
}

async function insertMediaRecord(item) {
  const result = await getPool().query(
    `insert into app_media
      (file_name, original_file_name, object_key, public_url, media_type, mime_type, extension,
       size_bytes, title, alt_text, caption, description, folder, width, height, duration_seconds, uploaded_by)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning *`,
    [
      item.file_name,
      item.original_file_name,
      item.object_key,
      item.public_url,
      item.media_type,
      item.mime_type,
      item.extension,
      item.size_bytes,
      item.title || null,
      item.alt_text || null,
      item.caption || null,
      item.description || null,
      item.folder || null,
      item.width || null,
      item.height || null,
      item.duration_seconds || null,
      item.uploaded_by || null
    ]
  );
  return mediaRow(result.rows[0]);
}

function mediaTiming(started, stageName, stageStarted) {
  const stage = Math.max(0, performance.now() - stageStarted).toFixed(1);
  const total = Math.max(0, performance.now() - started).toFixed(1);
  return `${stageName};dur=${stage}, node-total;dur=${total}`;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const value = parseBase64urlJson(cursor, 'cursor');
  if (!value.created_at || !value.id) throw statusError(400, 'Invalid cursor.', 'INVALID_CURSOR');
  return value;
}

function encodeCursor(row) {
  if (!row) return null;
  return base64urlJson({ created_at: row.sort_at || row.created_at, id: row.id });
}

async function listMedia(url) {
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 50), 100));
  const where = [];
  const params = [];
  const type = String(url.searchParams.get('type') || '').trim().toLowerCase();
  const folder = String(url.searchParams.get('folder') || '').trim();
  const search = String(url.searchParams.get('search') || '').trim();
  const cursor = decodeCursor(url.searchParams.get('cursor') || '');
  const trash = url.searchParams.get('trash') === 'true';

  where.push(trash ? 'deleted_at is not null' : 'deleted_at is null');

  if (type && type !== 'all') {
    if (!['image', 'video', 'document', 'other'].includes(type)) throw statusError(400, 'Unsupported media type.', 'INVALID_MEDIA_TYPE');
    params.push(type);
    where.push(`media_type = $${params.length}`);
  }
  if (folder) {
    params.push(folder);
    where.push(`folder = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[%_]/g, '\\$&')}%`);
    where.push(`(file_name ilike $${params.length} escape '\\' or original_file_name ilike $${params.length} escape '\\' or title ilike $${params.length} escape '\\' or alt_text ilike $${params.length} escape '\\' or folder ilike $${params.length} escape '\\')`);
  }
  if (cursor) {
    params.push(cursor.created_at, cursor.id);
    where.push(`(${trash ? 'deleted_at' : 'created_at'}, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  params.push(limit + 1);
  const result = await getPool().query(
    `select id, file_name, original_file_name, public_url, media_type, mime_type, extension,
            size_bytes, title, alt_text, caption, folder, width, height, duration_seconds,
            uploaded_by, deleted_at, created_at, updated_at, ${trash ? 'deleted_at' : 'created_at'} as sort_at
     from app_media
     ${whereSql}
     order by ${trash ? 'deleted_at' : 'created_at'} desc, id desc
     limit $${params.length}`,
    params
  );
  const rows = result.rows;
  const items = rows.slice(0, limit).map(mediaSummary);
  const payload = { ok: true, items, next_cursor: rows.length > limit ? encodeCursor(rows[limit - 1]) : null };
  if (url.searchParams.get('include_total') === 'true') {
    const countParams = params.slice(0, -1);
    const count = await getPool().query(`select count(*)::int as total from app_media ${whereSql}`, countParams);
    payload.total = count.rows[0]?.total || 0;
  }
  return payload;
}

async function getMedia(id) {
  const result = await getPool().query('select * from app_media where id = $1::uuid limit 1', [id]);
  if (!result.rows[0]) throw statusError(404, 'Media item not found.', 'MEDIA_NOT_FOUND');
  return { ok: true, item: mediaRow(result.rows[0]) };
}

async function updateMedia(id, body) {
  const allowed = ['title', 'alt_text', 'caption', 'description', 'folder'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    params.push(key === 'folder' ? safeFolder(body[key]) : String(body[key] || '').slice(0, 3000));
    updates.push(`${key} = $${params.length}`);
  }
  if (!updates.length) throw statusError(400, 'No supported metadata fields were provided.', 'NO_UPDATES');
  params.push(id);
  const result = await getPool().query(
    `update app_media set ${updates.join(', ')}, updated_at = now() where id = $${params.length}::uuid returning *`,
    params
  );
  if (!result.rows[0]) throw statusError(404, 'Media item not found.', 'MEDIA_NOT_FOUND');
  return { ok: true, item: mediaRow(result.rows[0]) };
}

async function deleteMedia(id) {
  const result = await getPool().query(
    `update app_media
     set deleted_at = coalesce(deleted_at, now()), updated_at = now()
     where id = $1::uuid and deleted_at is null
     returning id, object_key, deleted_at`,
    [id]
  );
  if (!result.rows[0]) throw statusError(404, 'Media item not found.', 'MEDIA_NOT_FOUND');
  return { ok: true, deleted: { id, object_key: result.rows[0].object_key, deleted_at: result.rows[0].deleted_at } };
}

async function restoreMedia(id) {
  const result = await getPool().query(
    `update app_media
     set deleted_at = null, updated_at = now()
     where id = $1::uuid and deleted_at is not null
     returning *`,
    [id]
  );
  if (!result.rows[0]) throw statusError(404, 'Media item not found in trash.', 'MEDIA_NOT_FOUND');
  return { ok: true, item: mediaRow(result.rows[0]) };
}

async function permanentlyDeleteMedia(id) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await client.query('select * from app_media where id = $1::uuid for update', [id]);
    const row = result.rows[0];
    if (!row) throw statusError(404, 'Media item not found.', 'MEDIA_NOT_FOUND');
    await deleteObject(row.object_key);
    await client.query('delete from app_media where id = $1::uuid', [id]);
    await client.query('commit');
    return { ok: true, permanently_deleted: { id, object_key: row.object_key } };
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

function parseMultipartUpload(req, user) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.includes('multipart/form-data')) return reject(statusError(400, 'Use multipart/form-data.', 'INVALID_MULTIPART'));
    const limits = mediaLimits();
    const backendLimit = limits.backend;
    const busboy = Busboy({ headers: req.headers, limits: { files: 20, fileSize: backendLimit } });
    const fields = {};
    const files = [];
    let failed = null;

    busboy.on('field', (name, value) => { fields[name] = value; });
    busboy.on('file', (name, file, info) => {
      const filename = info.filename || 'asset';
      const mimeType = cleanMime(info.mimeType || 'application/octet-stream');
      const chunks = [];
      let size = 0;
      let rejected = null;
      try { validateUpload({ filename, mimeType, size: 0 }); }
      catch (error) { rejected = error; }
      file.on('data', chunk => {
        size += chunk.length;
        if (!rejected && size > backendLimit) rejected = statusError(413, 'Use direct storage upload for files larger than the backend upload limit.', 'USE_PRESIGNED_UPLOAD');
        chunks.push(chunk);
      });
      file.on('limit', () => {
        rejected = statusError(413, 'Use direct storage upload for files larger than the backend upload limit.', 'USE_PRESIGNED_UPLOAD');
      });
      file.on('end', () => {
        if (!rejected) {
          try { validateUpload({ filename, mimeType, size }); }
          catch (error) { rejected = error; }
        }
        files.push({ filename, mimeType, buffer: rejected ? null : Buffer.concat(chunks), size, error: rejected });
      });
    });
    busboy.on('error', error => { failed = error; });
    busboy.on('finish', async () => {
      if (failed) return reject(failed);
      if (!files.length) return reject(statusError(400, 'Choose at least one file.', 'NO_FILES'));
      const items = [];
      try {
        for (const file of files) {
          if (file.error) throw file.error;
          const key = createObjectKey({ filename: file.filename, mimeType: file.mimeType });
          if (storageConfig().driver === 'local' && !['image', 'video'].includes(key.mediaType)) {
            throw statusError(400, 'Local storage mode currently supports image and video uploads only.', 'LOCAL_MEDIA_TYPES_ONLY');
          }
          const publicUrl = await uploadObject({ key: key.objectKey, body: file.buffer, contentType: file.mimeType });
          try {
            const item = await insertMediaRecord({
              file_name: key.fileName,
              original_file_name: file.filename,
              object_key: key.objectKey,
              public_url: publicUrl,
              media_type: key.mediaType,
              mime_type: file.mimeType,
              extension: key.extension,
              size_bytes: file.size,
              title: fields.title || path.parse(file.filename).name,
              alt_text: fields.alt_text || '',
              caption: fields.caption || '',
              description: fields.description || '',
              folder: safeFolder(fields.folder),
              uploaded_by: user.email
            });
            items.push(item);
          } catch (error) {
            await deleteObject(key.objectKey).catch(cleanupError => console.error(`[r2] orphan cleanup failed ${key.objectKey}: ${cleanupError.message || cleanupError}`));
            throw error;
          }
        }
        resolve({ ok: true, items });
      } catch (error) {
        reject(error);
      }
    });
    req.pipe(busboy);
  });
}

async function createUploadUrl(body, user) {
  const filename = String(body.file_name || body.filename || '').trim();
  const mimeType = cleanMime(body.mime_type || body.type || 'application/octet-stream');
  const size = Number(body.size_bytes || body.size || 0);
  if (!filename) throw statusError(400, 'File name is required.', 'FILE_NAME_REQUIRED');
  const validation = validateUpload({ filename, mimeType, size });
  const key = createObjectKey({ filename, mimeType });
  const uploadUrl = await createPresignedUploadUrl({ key: key.objectKey, contentType: mimeType });
  const token = signUpload({
    object_key: key.objectKey,
    file_name: key.fileName,
    original_file_name: filename,
    media_type: key.mediaType,
    mime_type: mimeType,
    extension: key.extension,
    expected_size: size || null,
    max_size: validation.maxBytes,
    folder: safeFolder(body.folder),
    title: String(body.title || path.parse(filename).name).slice(0, 300),
    uploaded_by: user.email,
    exp: Date.now() + 15 * 60 * 1000
  });
  return {
    ok: true,
    upload_url: uploadUrl,
    object_key: key.objectKey,
    public_url: createPublicUrl(key.objectKey),
    file_name: key.fileName,
    media_type: key.mediaType,
    token
  };
}

async function completeUpload(body, user) {
  const tokenPayload = verifyUploadToken(body.token);
  if (body.object_key && body.object_key !== tokenPayload.object_key) throw statusError(400, 'Upload key does not match the token.', 'UPLOAD_KEY_MISMATCH');
  const head = await headObject(tokenPayload.object_key);
  const size = Number(head.ContentLength || tokenPayload.expected_size || 0);
  validateUpload({ filename: tokenPayload.original_file_name, mimeType: tokenPayload.mime_type, size });
  const item = await insertMediaRecord({
    file_name: tokenPayload.file_name,
    original_file_name: tokenPayload.original_file_name,
    object_key: tokenPayload.object_key,
    public_url: createPublicUrl(tokenPayload.object_key),
    media_type: tokenPayload.media_type,
    mime_type: tokenPayload.mime_type,
    extension: tokenPayload.extension,
    size_bytes: size,
    title: String(body.title || tokenPayload.title || '').slice(0, 300),
    alt_text: String(body.alt_text || '').slice(0, 300),
    caption: String(body.caption || '').slice(0, 1000),
    description: String(body.description || '').slice(0, 3000),
    folder: safeFolder(body.folder || tokenPayload.folder),
    uploaded_by: user.email
  });
  return { ok: true, item };
}

async function handleApi(req, res) {
  const started = performance.now();
  const stageStarted = performance.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const method = req.method || 'GET';

  if (route === '/api/health' && method === 'GET') return sendJson(req, res, { ok: true });
  if (route === '/api/bootstrap' && method === 'GET') {
    let user = null;
    try { user = currentUser(req); } catch (error) { if (error.status !== 401 && error.code !== 'AUTH_NOT_CONFIGURED') throw error; }
    return sendJson(req, res, {
      ok: true,
      user: publicUser(user),
      auth_configured: configuredAuth(),
      media_storage_configured: storageConfigured(),
      storage_driver: storageConfig().driver,
      local_upload_types: storageConfig().driver === 'local' ? ['image', 'video'] : null,
      image_upload_only: false
    });
  }
  if (route === '/api/login' && method === 'POST') {
    if (!configuredAuth()) throw statusError(503, 'Set ADMIN_EMAIL and ADMIN_PASSWORD first.', 'AUTH_NOT_CONFIGURED');
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) throw statusError(401, 'Email or password is incorrect.', 'INVALID_LOGIN');
    const session = createSession();
    return sendJson(req, res, { ok: true, user: publicUser(session.user) }, 200, { 'Set-Cookie': sessionCookie(req, session.sid) });
  }
  if (route === '/api/logout' && method === 'POST') {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    return sendJson(req, res, { ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const user = currentUser(req);
  if (!route.startsWith('/api/media')) throw statusError(404, 'API route not found.', 'NOT_FOUND');

  if (route === '/api/media' && method === 'GET') {
    const payload = await listMedia(url);
    return sendJson(req, res, payload, 200, { 'Server-Timing': mediaTiming(started, 'media-query', stageStarted) });
  }
  if (route === '/api/media/upload' && method === 'POST') {
    if (!canManageMedia(user)) throw statusError(403, 'You do not have permission to upload media.', 'FORBIDDEN');
    const payload = await parseMultipartUpload(req, user);
    return sendJson(req, res, payload, 201, { 'Server-Timing': mediaTiming(started, 'media-upload', stageStarted) });
  }
  if (route === '/api/media/upload-url' && method === 'POST') {
    if (!canManageMedia(user)) throw statusError(403, 'You do not have permission to upload media.', 'FORBIDDEN');
    const payload = await createUploadUrl(await readJson(req), user);
    return sendJson(req, res, payload, 201, { 'Server-Timing': mediaTiming(started, 'media-upload', stageStarted) });
  }
  if (route === '/api/media/complete' && method === 'POST') {
    if (!canManageMedia(user)) throw statusError(403, 'You do not have permission to upload media.', 'FORBIDDEN');
    const payload = await completeUpload(await readJson(req), user);
    return sendJson(req, res, payload, 201, { 'Server-Timing': mediaTiming(started, 'media-upload', stageStarted) });
  }

  const restoreMatch = route.match(/^\/api\/media\/([0-9a-f-]{36})\/restore$/i);
  if (restoreMatch && method === 'POST') {
    if (!canManageMedia(user)) throw statusError(403, 'You do not have permission to restore media.', 'FORBIDDEN');
    return sendJson(req, res, await restoreMedia(restoreMatch[1]));
  }

  const match = route.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  if (match && method === 'GET') return sendJson(req, res, await getMedia(match[1]), 200, { 'Server-Timing': mediaTiming(started, 'media-query', stageStarted) });
  if (match && method === 'PATCH') return sendJson(req, res, await updateMedia(match[1], await readJson(req)));
  if (match && method === 'DELETE') {
    if (!canManageMedia(user)) throw statusError(403, 'You do not have permission to delete media.', 'FORBIDDEN');
    if (url.searchParams.get('permanent') === 'true') return sendJson(req, res, await permanentlyDeleteMedia(match[1]));
    return sendJson(req, res, await deleteMedia(match[1]));
  }
  throw statusError(404, 'API route not found.', 'NOT_FOUND');
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    sendJson(req, res, { ok: false, error: 'NOT_FOUND', message: 'Not found.' }, 404);
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/media/')) {
    const config = storageConfig();
    const root = path.resolve(ROOT, config.localMediaDir);
    const filePath = path.resolve(root, pathname.slice('/media/'.length));
    if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) {
      sendJson(req, res, { ok: false, error: 'NOT_FOUND', message: 'Not found.' }, 404);
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        sendJson(req, res, { ok: false, error: 'NOT_FOUND', message: 'Not found.' }, 404);
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      if (req.method === 'HEAD') res.end();
      else res.end(content);
    });
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const allowed = new Set(['/index.html', '/app.js', '/styles.css', '/sw.js', '/manifest.webmanifest', '/offline.html']);
  if (!allowed.has(pathname)) {
    sendJson(req, res, { ok: false, error: 'NOT_FOUND', message: 'Not found.' }, 404);
    return;
  }
  const filePath = path.join(ROOT, pathname.slice(1));
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(req, res, { ok: false, error: 'NOT_FOUND', message: 'Not found.' }, 404);
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': pathname === '/index.html' ? 'no-store' : 'public, max-age=300'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (String(req.url || '').startsWith('/api/')) {
    handleApi(req, res).catch(error => sendError(req, res, error));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!configuredAuth()) missing.push('ADMIN_EMAIL/ADMIN_PASSWORD');
  if (!storageConfigured()) missing.push('S3_* media storage');
  console.log(`Media uploader listening on http://localhost:${PORT}`);
  console.log(`Media storage driver: ${storageConfig().driver}`);
  if (missing.length) console.warn(`Configuration missing: ${missing.join(', ')}. Existing server routes still boot; affected APIs return clear errors.`);
});

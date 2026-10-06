'use strict';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const state = {
  user: null,
  authConfigured: true,
  storageConfigured: true,
  items: [],
  nextCursor: null,
  loading: false,
  filters: { search: '', type: 'all', folder: '' },
  uploads: []
};

function icon(name) {
  const paths = {
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><rect x="2" y="2" width="13" height="13" rx="2"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 16h10l1-16"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    video: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="m17 10 4-2v8l-4-2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  const text = await res.text();
  const value = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401) {
      state.user = null;
      render();
    }
    const error = new Error(value.message || value.error || 'Request failed.');
    error.code = value.error;
    error.status = res.status;
    throw error;
  }
  return value;
}

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('show'), 2600);
}

function fmtBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let number = Number(value || 0);
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) {
    number /= 1024;
    unit += 1;
  }
  return `${number >= 10 || unit === 0 ? number.toFixed(0) : number.toFixed(1)} ${units[unit]}`;
}

function fmtDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function mediaIcon(type) {
  if (type === 'image') return icon('image');
  if (type === 'video') return icon('video');
  return icon('file');
}

function embedCode(item) {
  const alt = esc(item.alt_text || item.title || item.file_name || '');
  if (item.media_type === 'image') return `<img src="${item.public_url}" alt="${alt}">`;
  if (item.media_type === 'video') return `<video controls preload="metadata">\n  <source src="${item.public_url}" type="${item.mime_type || 'video/mp4'}">\n</video>`;
  return '';
}

async function copyText(text, label = 'Copied') {
  await navigator.clipboard.writeText(text);
  toast(label);
}

function uploadRow(upload) {
  return `<div class="upload-row ${upload.failed ? 'failed' : upload.state === 'Uploaded' ? 'success' : ''}">
    <div><strong>${esc(upload.name)}</strong><span>${esc(upload.state)}</span></div>
    <div class="progress"><span style="width:${Math.max(0, Math.min(upload.progress, 100))}%"></span></div>
    <b>${Math.round(upload.progress)}%</b>
  </div>`;
}

function mediaCard(item) {
  const preview = item.media_type === 'image'
    ? `<img src="${esc(item.public_url)}" alt="${esc(item.alt_text || item.title || item.file_name)}" loading="lazy">`
    : item.media_type === 'video'
      ? `<video src="${esc(item.public_url)}" preload="metadata" muted></video>`
      : `<div class="file-preview">${mediaIcon(item.media_type)}</div>`;
  return `<article class="media-card" data-id="${esc(item.id)}">
    <button class="media-preview" data-act="details" data-id="${esc(item.id)}">${preview}</button>
    <div class="media-copy">
      <strong>${esc(item.title || item.file_name)}</strong>
      <p>${esc(item.media_type)} · ${fmtBytes(item.size_bytes)} · ${fmtDate(item.created_at)}</p>
      <small>${esc(item.mime_type || '')}</small>
    </div>
    <div class="card-actions">
      <button class="icon-button" data-act="copy-url" data-id="${esc(item.id)}" title="Copy URL">${icon('copy')}</button>
      ${embedCode(item) ? `<button class="icon-button" data-act="copy-embed" data-id="${esc(item.id)}" title="Copy embed">${icon('link')}</button>` : ''}
      <button class="icon-button" data-act="details" data-id="${esc(item.id)}" title="Details">${icon('edit')}</button>
      <button class="icon-button danger" data-act="delete" data-id="${esc(item.id)}" title="Delete">${icon('trash')}</button>
    </div>
  </article>`;
}

function loginView() {
  return `<main class="login">
    <section class="login-panel">
      <div class="brand-mark">ML</div>
      <h1>Media Library</h1>
      ${state.authConfigured ? `<form id="login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="button primary" type="submit">Sign in</button>
      </form>` : `<div class="notice danger">Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then restart the server.</div>`}
    </section>
  </main>`;
}

function libraryView() {
  const uploading = state.uploads.length ? `<section class="upload-list">${state.uploads.map(uploadRow).join('')}</section>` : '';
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span>ML</span><b>Media Library</b></div>
      <button class="nav active">${icon('image')}Media Library</button>
      <button class="nav" data-act="logout">${icon('close')}Sign out</button>
    </aside>
    <main class="workspace">
      <header class="heading">
        <div><h1>Media Library</h1><p>Private asset manager for website files.</p></div>
        <div class="actions">
          <button class="button soft" data-act="new-folder">New folder</button>
          <button class="button primary" data-act="browse" ${state.storageConfigured ? '' : 'disabled'}>${icon('upload')}Upload files</button>
          <input id="file-input" type="file" multiple hidden>
        </div>
      </header>
      ${state.storageConfigured ? '' : '<div class="notice danger">Media storage is not configured. Add the S3-compatible storage environment variables before uploading.</div>'}
      <section class="drop-zone ${state.storageConfigured ? '' : 'disabled'}" id="drop-zone">
        <div>${icon('upload')}<strong>Drag files here</strong><span>or choose files from your device</span></div>
        <button class="button" data-act="browse" ${state.storageConfigured ? '' : 'disabled'}>Browse Files</button>
      </section>
      ${uploading}
      <section class="toolbar">
        <label class="search">${icon('search')}<input id="search" placeholder="Search media..." value="${esc(state.filters.search)}"></label>
        <select id="type-filter">
          ${['all', 'image', 'video', 'document', 'other'].map(type => `<option value="${type}" ${state.filters.type === type ? 'selected' : ''}>${type === 'all' ? 'All' : `${type[0].toUpperCase()}${type.slice(1)}s`}</option>`).join('')}
        </select>
        <input id="folder-filter" placeholder="Folder" value="${esc(state.filters.folder)}">
      </section>
      <section class="media-grid" id="media-grid">
        ${state.items.length ? state.items.map(mediaCard).join('') : `<div class="empty">${icon('image')}<h2>No media yet</h2><p>Upload your first image, video or document.</p></div>`}
      </section>
      ${state.nextCursor ? `<div class="load-more"><button class="button soft" data-act="load-more">Load more</button></div>` : ''}
    </main>
  </div>`;
}

function render() {
  $('#app').innerHTML = state.user ? libraryView() : loginView();
}

async function bootstrap() {
  const result = await api('/api/bootstrap');
  state.user = result.user;
  state.authConfigured = result.auth_configured !== false;
  state.storageConfigured = result.media_storage_configured !== false;
  render();
  if (state.user) await loadMedia(true);
}

function mediaQuery(reset = false) {
  const params = new URLSearchParams({ limit: '50' });
  if (!reset && state.nextCursor) params.set('cursor', state.nextCursor);
  if (state.filters.type && state.filters.type !== 'all') params.set('type', state.filters.type);
  if (state.filters.folder.trim()) params.set('folder', state.filters.folder.trim());
  if (state.filters.search.trim()) params.set('search', state.filters.search.trim());
  return `/api/media?${params}`;
}

async function loadMedia(reset = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    const result = await api(mediaQuery(reset), { method: 'GET' });
    state.items = reset ? result.items || [] : [...state.items, ...(result.items || [])];
    state.nextCursor = result.next_cursor || null;
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
  }
}

function clientMediaType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (/pdf|word|excel|spreadsheet|text|csv/i.test(file.type) || /\.(pdf|docx?|xlsx?|txt|csv)$/i.test(file.name)) return 'document';
  return 'other';
}

function xhrUpload(url, options, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || 'POST', url);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(options.headers || {})) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      let value = {};
      try { value = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(value);
      else reject(new Error(value.message || `Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error('Network interrupted during upload.'));
    xhr.send(options.body);
  });
}

async function uploadViaBackend(file, upload) {
  const form = new FormData();
  form.append('files', file);
  if (state.filters.folder.trim()) form.append('folder', state.filters.folder.trim());
  const result = await xhrUpload('/api/media/upload', { method: 'POST', body: form }, progress => {
    upload.progress = progress;
    updateUploadList();
  });
  return result.items?.[0];
}

async function uploadViaPresigned(file, upload) {
  const request = await api('/api/media/upload-url', {
    method: 'POST',
    body: {
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      folder: state.filters.folder.trim()
    }
  });
  await xhrUpload(request.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  }, progress => {
    upload.progress = progress;
    updateUploadList();
  });
  const result = await api('/api/media/complete', {
    method: 'POST',
    body: { token: request.token, object_key: request.object_key, folder: state.filters.folder.trim() }
  });
  return result.item;
}

function updateUploadList() {
  const list = $('.upload-list');
  if (list) list.innerHTML = state.uploads.map(uploadRow).join('');
}

async function uploadFiles(files) {
  const selected = [...files];
  if (!selected.length) return;
  if (!state.storageConfigured) {
    toast('Configure media storage before uploading.');
    return;
  }
  if (state.uploads.some(upload => upload.state === 'Uploading')) {
    toast('Upload already in progress');
    return;
  }
  state.uploads = selected.map(file => ({ name: file.name, progress: 0, state: 'Waiting' }));
  render();
  let successCount = 0;
  let failureCount = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const file = selected[index];
    const upload = state.uploads[index];
    upload.state = 'Uploading';
    updateUploadList();
    try {
      const usePresigned = clientMediaType(file) === 'video' || file.size > 15 * 1024 * 1024;
      const item = usePresigned ? await uploadViaPresigned(file, upload) : await uploadViaBackend(file, upload);
      upload.progress = 100;
      upload.state = 'Uploaded';
      if (item) state.items.unshift(item);
      successCount += 1;
      updateUploadList();
    } catch (error) {
      upload.failed = true;
      upload.progress = 0;
      upload.state = `Failed: ${error.message}`;
      failureCount += 1;
      updateUploadList();
    }
  }
  render();
  if (successCount && failureCount) toast(`${successCount} uploaded, ${failureCount} failed.`);
  else if (successCount) toast(`${successCount} file${successCount === 1 ? '' : 's'} uploaded.`);
  else toast('Upload failed.');
}

async function showDetails(id) {
  const existing = state.items.find(item => item.id === id);
  const result = await api(`/api/media/${encodeURIComponent(id)}`, { method: 'GET' });
  const item = result.item || existing;
  const embed = embedCode(item);
  const preview = item.media_type === 'image'
    ? `<img src="${esc(item.public_url)}" alt="${esc(item.alt_text || item.title || item.file_name)}">`
    : item.media_type === 'video'
      ? `<video src="${esc(item.public_url)}" controls preload="metadata"></video>`
      : `<div class="file-preview large">${mediaIcon(item.media_type)}</div>`;
  const dialog = $('#details');
  dialog.innerHTML = `<form id="details-form" method="dialog">
    <header class="dialog-head"><h2>${esc(item.file_name)}</h2><button type="button" class="icon-button" data-act="close-dialog">${icon('close')}</button></header>
    <div class="dialog-body">
      <div class="details-grid">
        <div class="details-preview">${preview}</div>
        <dl class="meta">
          <dt>Public URL</dt><dd><code>${esc(item.public_url)}</code><button type="button" class="icon-button" data-act="dialog-copy-url">${icon('copy')}</button></dd>
          <dt>File type</dt><dd>${esc(item.media_type)}</dd>
          <dt>MIME type</dt><dd>${esc(item.mime_type || '')}</dd>
          <dt>File size</dt><dd>${fmtBytes(item.size_bytes)}</dd>
          <dt>Uploaded</dt><dd>${fmtDate(item.created_at)}</dd>
          <dt>Folder</dt><dd>${esc(item.folder || 'None')}</dd>
          <dt>Uploaded by</dt><dd>${esc(item.uploaded_by || 'Unknown')}</dd>
        </dl>
      </div>
      ${embed ? `<label>Embed code<textarea readonly>${esc(embed)}</textarea></label><button type="button" class="button soft" data-act="dialog-copy-embed">${icon('copy')}Copy Embed</button>` : ''}
      <div class="form-grid">
        <label>Title<input name="title" value="${esc(item.title || '')}"></label>
        <label>Alt text<input name="alt_text" value="${esc(item.alt_text || '')}"></label>
        <label>Folder<input name="folder" value="${esc(item.folder || '')}"></label>
        <label>Caption<input name="caption" value="${esc(item.caption || '')}"></label>
      </div>
      <label>Description<textarea name="description">${esc(item.description || '')}</textarea></label>
      <div class="dialog-actions">
        <button type="button" class="button danger" data-act="dialog-delete">${icon('trash')}Delete</button>
        <button class="button primary" value="save">${icon('edit')}Save</button>
      </div>
    </div>
  </form>`;
  dialog.dataset.id = id;
  dialog.dataset.url = item.public_url;
  dialog.dataset.embed = embed;
  dialog.showModal();
}

async function saveDetails(form) {
  const id = $('#details').dataset.id;
  const body = Object.fromEntries(new FormData(form).entries());
  const result = await api(`/api/media/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  state.items = state.items.map(item => item.id === id ? { ...item, ...result.item } : item);
  $('#details').close();
  render();
  toast('Metadata saved');
}

async function deleteMedia(id) {
  if (!confirm('Delete this media item?')) return;
  await api(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.items = state.items.filter(item => item.id !== id);
  $('#details')?.close();
  render();
  toast('Media deleted');
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  const id = target.dataset.id;
  try {
    if (act === 'browse') {
      if (!state.storageConfigured) {
        toast('Configure media storage before uploading.');
        return;
      }
      $('#file-input').click();
    }
    if (act === 'logout') {
      await api('/api/logout', { method: 'POST', body: {} });
      state.user = null;
      render();
    }
    if (act === 'new-folder') {
      const folder = prompt('Folder name', state.filters.folder || '');
      if (folder !== null) {
        state.filters.folder = folder.trim();
        await loadMedia(true);
      }
    }
    if (act === 'load-more') await loadMedia(false);
    if (act === 'copy-url') {
      const item = state.items.find(row => row.id === id);
      if (item) await copyText(item.public_url, 'URL copied');
    }
    if (act === 'copy-embed') {
      const item = state.items.find(row => row.id === id);
      if (item) await copyText(embedCode(item), 'Embed copied');
    }
    if (act === 'details') await showDetails(id);
    if (act === 'delete') await deleteMedia(id);
    if (act === 'dialog-copy-url') await copyText($('#details').dataset.url, 'URL copied');
    if (act === 'dialog-copy-embed') await copyText($('#details').dataset.embed, 'Embed copied');
    if (act === 'dialog-delete') await deleteMedia($('#details').dataset.id);
    if (act === 'close-dialog') $('#details').close();
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'file-input') uploadFiles(event.target.files);
  if (event.target.id === 'type-filter') {
    state.filters.type = event.target.value;
    loadMedia(true);
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.filters.search = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadMedia(true), 250);
  }
  if (event.target.id === 'folder-filter') {
    state.filters.folder = event.target.value;
    clearTimeout(state.folderTimer);
    state.folderTimer = setTimeout(() => loadMedia(true), 350);
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (event.target.id === 'login-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      const result = await api('/api/login', { method: 'POST', body: values });
      state.user = result.user;
      render();
      await loadMedia(true);
    }
    if (event.target.id === 'details-form') await saveDetails(event.target);
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('dragover', event => {
  if (event.target.closest('#drop-zone')) {
    event.preventDefault();
    $('#drop-zone').classList.add('dragging');
  }
});

document.addEventListener('dragleave', event => {
  if (event.target.closest('#drop-zone')) $('#drop-zone').classList.remove('dragging');
});

document.addEventListener('drop', event => {
  if (!event.target.closest('#drop-zone')) return;
  event.preventDefault();
  $('#drop-zone').classList.remove('dragging');
  if (!state.storageConfigured) {
    toast('Configure media storage before uploading.');
    return;
  }
  uploadFiles(event.dataTransfer.files);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => null);
bootstrap().catch(error => {
  $('#app').innerHTML = `<main class="offline"><h1>Unable to start</h1><p>${esc(error.message)}</p></main>`;
});

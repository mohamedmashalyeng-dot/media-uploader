'use strict';

const requiredFiles = [
  'server.js',
  'app.js',
  'styles.css',
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'package.json',
  'package-lock.json',
  'lib/media-utils.js',
  'lib/object-storage.js',
  'sql/2026-10-05_app_media.sql'
];

const requiredPackages = [
  '@aws-sdk/client-s3',
  '@aws-sdk/s3-request-presigner',
  'busboy',
  'pg'
];

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(root, file)));
const missingPackages = [];

for (const pkg of requiredPackages) {
  try {
    require.resolve(pkg, { paths: [root] });
  } catch {
    missingPackages.push(pkg);
  }
}

const major = Number(process.versions.node.split('.')[0]);
const problems = [];
if (major < 18) problems.push(`Node.js 18+ is required. Current version: ${process.version}`);
if (missingFiles.length) problems.push(`Missing files: ${missingFiles.join(', ')}`);
if (missingPackages.length) problems.push(`Run npm install. Missing packages: ${missingPackages.join(', ')}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log('Hostinger preflight passed.');
console.log('Startup file: server.js');
console.log('Start command: npm start');

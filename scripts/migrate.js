'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=require/i.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined
  });
  try {
    const dir = path.join(__dirname, '..', 'sql');
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
      await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      console.log(`Migration applied: sql/${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

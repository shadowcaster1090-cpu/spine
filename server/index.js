import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = +process.env.PORT || 3000;

const db = openDb(path.join(DATA, 'spine.db'));
const handler = createApp({ db, uploadsDir: path.join(DATA, 'uploads'), secureCookies: process.env.SECURE_COOKIES === '1' });
const server = http.createServer(handler);
server.listen(PORT, () => console.log(`Spine is running at http://localhost:${PORT}`));

const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

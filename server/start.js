import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(project, '..', '.sideline-data'));
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535.');
const { app, close } = createApp({ databasePath: path.join(dataDirectory, 'sideline.sqlite'), appOrigin: process.env.APP_ORIGIN || null, isProduction: process.env.NODE_ENV === 'production' });
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Sideline server listening on port ${port}.`));
server.on('error', (error) => { console.error(`The server could not start (${error.code || 'unknown error'}).`); close(); process.exitCode = 1; });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { close(); process.exit(0); });
  setTimeout(() => { server.closeAllConnections(); close(); process.exit(0); }, 10_000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

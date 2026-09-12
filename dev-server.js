import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '.env.local'), override: true, quiet: true });

const port = Number(process.env.PORT) || 4178;
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const app = await createApp({ development: !production });
app.listen(port, '127.0.0.1', () => console.log(`SWARM MIND OS ready at http://127.0.0.1:${port}`));

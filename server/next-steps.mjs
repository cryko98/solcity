// After `npm install`: what to do next, until server/.env exists (see ../SETUP.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(here, '.env'))) {
  console.log(`
  Sol City server installed. Next (details in SETUP.md at the top of the repo):
    1. cp .env.example .env && chmod 600 .env
    2. fill in .env: SESSION_SECRET, PUBLIC_DOMAIN, SOLANA_RPC_URL, SOLCITY_MINT,
       TREASURY_SECRET_KEY (a new hot wallet, never the main treasury). Keep DRY_RUN=true.
       Never paste .env or a secret key into a chat or a commit.
    3. npm test, then node index.mjs
`);
}

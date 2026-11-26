// Genera el cliente de Prisma solo si falta o si el schema cambió desde la última generación.
// En Windows, regenerarlo con la API corriendo falla (EPERM) porque el motor está en uso;
// así `build` y `typecheck` funcionan tanto después de `npm ci` como con `dev:backend` levantado.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(backendDir, 'prisma', 'schema.prisma');

/** Busca node_modules/.prisma/client subiendo desde apps/backend (workspaces lo instalan en la raíz). */
function findGeneratedSchema() {
  let dir = backendDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', '.prisma', 'client', 'schema.prisma');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const generated = findGeneratedSchema();

if (generated && read(generated) === read(schemaPath)) {
  console.log('Prisma Client al día: no se regenera.');
} else {
  execSync('prisma generate', { cwd: backendDir, stdio: 'inherit' });
}

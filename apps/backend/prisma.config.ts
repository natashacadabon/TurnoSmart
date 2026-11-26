import 'dotenv/config';

import { defineConfig } from 'prisma/config';
import { assertSupabaseTarget } from './src/config/supabase-target.js';

// Prisma carga esta configuración antes de migrar; generate/validate no conectan a la base.
if (process.argv.includes('migrate')) assertSupabaseTarget(process.env, true);

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },
});

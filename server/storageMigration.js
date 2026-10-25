import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Only legacy imports retain the former application name.
export function migrateDatabase(dataDir) {
  const target = path.join(dataDir, 'pin-le-ge-dou.db');
  const legacy = path.join(dataDir, 'picture-play.db');
  if (existsSync(target) || !existsSync(legacy)) return;
  const source = new DatabaseSync(legacy, { readOnly: true });
  try {
    // SQLite creates a consistent copy, including committed WAL transactions.
    source.prepare('VACUUM INTO ?').run(target);
  } finally {
    source.close();
  }
}

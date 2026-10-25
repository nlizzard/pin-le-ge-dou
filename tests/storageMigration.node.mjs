import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../server/storageMigration.js';

test('database rename preserves committed WAL data and never overwrites the new database', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pin-le-ge-dou-migration-'));
  let old, current;
  try {
    old = new DatabaseSync(path.join(dir, 'picture-play.db'));
    old.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE progress (value TEXT); INSERT INTO progress VALUES ('saved');");
    migrateDatabase(dir);
    current = new DatabaseSync(path.join(dir, 'pin-le-ge-dou.db'));
    assert.equal(current.prepare('SELECT value FROM progress').get().value, 'saved');
    current.exec("UPDATE progress SET value='newer'");
    migrateDatabase(dir);
    assert.equal(current.prepare('SELECT value FROM progress').get().value, 'newer');
    assert.equal(old.prepare('SELECT value FROM progress').get().value, 'saved');
  } finally {
    current?.close(); old?.close();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});

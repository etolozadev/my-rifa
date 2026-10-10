import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sequelize } from '../src/db';

async function main() {
  const sql = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  await sequelize.query(sql);
  console.log('Esquema aplicado.');
  await sequelize.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

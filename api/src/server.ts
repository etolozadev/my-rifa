import { createApp } from './app';
import { config } from './config';
import { sequelize } from './db';
import { startExpireJob } from './jobs/expire';

async function main() {
  await sequelize.authenticate();
  const app = createApp();
  startExpireJob();
  app.listen(config.PORT, () => console.log(`mis-rifas API en http://localhost:${config.PORT}`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

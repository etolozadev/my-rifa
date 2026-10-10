import bcrypt from 'bcryptjs';
import { sequelize } from '../src/db';
import { User } from '../src/models';

// Uso: npm run user:password -- correo@ejemplo.cl "nueva-contraseña-larga"
// En producción: docker compose -f docker-compose.prod.yml exec api node dist/scripts/set-password.js correo "clave"
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error('Uso: npm run user:password -- correo@ejemplo.cl "contraseña de 10+ caracteres"');
    process.exit(1);
  }
  const user: any = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No existe un usuario con el correo ${email}`);
    process.exit(1);
  }
  await user.update({ passwordHash: await bcrypt.hash(password, 12) });
  console.log(`Contraseña actualizada para ${user.email}`);
  await sequelize.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

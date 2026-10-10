import bcrypt from 'bcryptjs';
import { sequelize } from '../src/db';
import { User } from '../src/models';

// Uso: npm run user:create -- "Nombre" correo@ejemplo.cl "contraseña-larga"
async function main() {
  const [nombre, email, password] = process.argv.slice(2);
  if (!nombre || !email || !password || password.length < 10) {
    console.error('Uso: npm run user:create -- "Nombre" correo@ejemplo.cl "contraseña de 10+ caracteres"');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const u: any = await User.create({ nombre, email: email.toLowerCase(), passwordHash, creadoEn: new Date() });
  console.log(`Usuario creado: ${u.email} (id ${u.id})`);
  await sequelize.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

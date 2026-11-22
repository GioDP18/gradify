/**
 * Provisions an instructor account (there is no public registration).
 *
 *   npm run create-instructor                    # interactive prompts (password hidden)
 *   npm run create-instructor -- --reset-password  # set a new password for an existing account
 *   npm run create-admin                         # the administrator (manages instructors and criteria)
 *
 * Non-interactive (e.g. CI / first deploy): set INSTRUCTOR_NAME, INSTRUCTOR_EMAIL,
 * INSTRUCTOR_PASSWORD (and optionally INSTRUCTOR_USERNAME) in the environment for this one run.
 * Never commit these values.
 */
import readline from 'node:readline';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User, ROLES } from '../models/User.js';
import { checkPasswordStrength, hashPassword, PASSWORD_RULES } from '../utils/password.js';
import { recordAudit } from '../services/audit.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const resetPassword = process.argv.includes('--reset-password');
const asAdmin = process.argv.includes('--admin');
const roleLabel = asAdmin ? 'Administrator' : 'Instructor';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Suppress echo of typed characters.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
        else if (text.includes('\n') || text.includes('\r')) rl.output.write('\n');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptPassword() {
  if (process.env.INSTRUCTOR_PASSWORD) return process.env.INSTRUCTOR_PASSWORD;
  for (;;) {
    const password = await ask('Password: ', { hidden: true });
    const problems = checkPasswordStrength(password);
    if (problems.length) {
      console.log(`  Password needs ${problems.join(', ')}.`);
      continue;
    }
    const confirm = await ask('Confirm password: ', { hidden: true });
    if (confirm !== password) {
      console.log('  Passwords do not match.');
      continue;
    }
    return password;
  }
}

async function main() {
  const email = (process.env.INSTRUCTOR_EMAIL || (await ask(`${roleLabel} email: `))).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error('A valid email address is required.');

  await connectDatabase({ uri: env.mongodb.uri, dbName: env.mongodb.dbName, autoIndex: true, dnsServers: env.mongodb.dnsServers });
  await User.init(); // ensure unique indexes exist before inserting

  const existing = await User.findOne({ email });

  if (resetPassword) {
    if (!existing) throw new Error(`No account found for ${email}.`);
    const password = await promptPassword();
    const problems = checkPasswordStrength(password);
    if (problems.length) throw new Error(`Password must have ${PASSWORD_RULES}.`);
    await User.updateOne(
      { _id: existing._id },
      { $set: { passwordHash: await hashPassword(password), failedLoginCount: 0 }, $unset: { lockUntil: 1 } },
    );
    await recordAudit({ userId: existing._id, action: 'USER_PASSWORD_RESET_CLI', collection: 'users', recordId: existing._id });
    console.log(`Password updated for ${email}.`);
    return;
  }

  if (existing) throw new Error(`An account for ${email} already exists. Use --reset-password to change its password.`);

  const name = process.env.INSTRUCTOR_NAME || (await ask('Full name: '));
  if (!name) throw new Error('Name is required.');
  const username = (process.env.INSTRUCTOR_USERNAME ?? (await ask('Username (optional, press Enter to skip): '))).toLowerCase() || undefined;
  const password = await promptPassword();
  const problems = checkPasswordStrength(password);
  if (problems.length) throw new Error(`Password must have ${PASSWORD_RULES}.`);

  const user = await User.create({
    name,
    email,
    username,
    role: asAdmin ? ROLES.ADMIN : ROLES.INSTRUCTOR,
    passwordHash: await hashPassword(password),
  });
  await recordAudit({ userId: user._id, action: 'USER_CREATE_CLI', collection: 'users', recordId: user._id, newValue: user.toPublic() });
  console.log(`${roleLabel} account created for ${email}${username ? ` (username: ${username})` : ''}.`);
}

main()
  .catch((error) => {
    console.error(`Error: ${error.code === 11000 ? 'That email or username is already in use.' : error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase().catch(() => {}));

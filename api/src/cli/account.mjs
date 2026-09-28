// Manage the dashboard's owner account from the server. Public sign-up is
// disabled, so this is the only way to create the account or recover it.
//
//   docker exec -it current-api-1 node src/cli/account.mjs <command>
//
//   create        create the account (prompts for email, name, password)
//   set-password  set a new password; signs out every session
//   disable-2fa   turn off two-factor (lost authenticator); signs out every session
//   sign-out-all  end every session
import { createInterface } from 'readline'
import { auth } from '../auth.js'
import { pool } from '../db/client.js'

const MIN_PASSWORD = 12

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      // Echo nothing while the password is typed.
      rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s) }
    }
    rl.question(question, answer => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

async function askPassword() {
  const password = await ask(`Password (${MIN_PASSWORD}+ characters): `, { hidden: true })
  if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`)
  if (password.length > 128) throw new Error('Password must be at most 128 characters')
  if (password !== await ask('Repeat password: ', { hidden: true })) throw new Error('Passwords do not match')
  return password
}

async function findOwner(ctx) {
  const email = await ask('Account email: ')
  const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase())
  if (!found?.user) throw new Error(`No account for ${email}`)
  return found.user
}

const commands = {
  async create(ctx) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "user"')
    if (rows[0].n > 0) throw new Error('An account already exists; use set-password to change its password')
    const email = (await ask('Email: ')).toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Not a valid email address')
    const name = (await ask('Name: ')) || email
    const password = await askPassword()
    const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true })
    await ctx.internalAdapter.linkAccount({
      userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password),
    })
    console.log(`Created ${email}. Sign in at the site, then turn on two-factor under Account.`)
  },

  async 'set-password'(ctx) {
    const user = await findOwner(ctx)
    const password = await askPassword()
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password))
    await ctx.internalAdapter.deleteUserSessions(user.id)
    console.log('Password updated; every session was signed out.')
  },

  async 'disable-2fa'(ctx) {
    const user = await findOwner(ctx)
    await pool.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [user.id])
    await pool.query('UPDATE "user" SET "twoFactorEnabled" = false WHERE id = $1', [user.id])
    await ctx.internalAdapter.deleteUserSessions(user.id)
    console.log('Two-factor turned off; every session was signed out. Turn it on again under Account.')
  },

  async 'sign-out-all'(ctx) {
    const user = await findOwner(ctx)
    await ctx.internalAdapter.deleteUserSessions(user.id)
    console.log('Every session was signed out.')
  },
}

const command = commands[process.argv[2]]
if (!command) {
  console.log(`Usage: node src/cli/account.mjs <${Object.keys(commands).join(' | ')}>`)
  process.exit(1)
}
try {
  await command(await auth.$context)
  process.exitCode = 0
} catch (e) {
  console.error(`Error: ${e.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

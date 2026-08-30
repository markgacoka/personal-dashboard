#!/usr/bin/env node
// Run once locally to get a Gmail refresh token.
// Usage: node scripts/get-gmail-token.js path/to/client_secret.json
import { readFileSync } from 'fs'
import { createInterface } from 'readline'
import { google } from 'googleapis'

const credFile = process.argv[2]
if (!credFile) {
  console.error('Usage: node scripts/get-gmail-token.js path/to/client_secret.json')
  process.exit(1)
}

const creds = JSON.parse(readFileSync(credFile, 'utf8'))
const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  prompt: 'consent',
})

console.log('\n1. Open this URL in your browser:\n')
console.log(authUrl)
console.log('\n2. Approve access, then paste the code from the redirect URL:\n')

const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.question('Code: ', async (code) => {
  rl.close()
  const { tokens } = await oAuth2Client.getToken(code.trim())
  console.log('\nAdd these to your .env file on the VPS:\n')
  console.log(`GMAIL_CLIENT_ID=${client_id}`)
  console.log(`GMAIL_CLIENT_SECRET=${client_secret}`)
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`)
})

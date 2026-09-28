import 'dotenv/config'
import { buildApp } from './app.js'

const app = await buildApp()
await app.listen({ port: parseInt(process.env.PORT || '3000', 10), host: process.env.HOST || '127.0.0.1' })

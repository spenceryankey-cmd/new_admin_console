import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { json } from 'express'
import { rateLimit } from './common/rate-limit'
import { loadEnv } from './config/env'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  // Railway puts one proxy in front, so the caller's address is the first forwarded one.
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(rateLimit({ windowMs: 60_000, max: 600 }))
  app.use(json({ limit: '200kb' }))
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  app.enableCors({
    origin: origins.length ? origins : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  app.enableShutdownHooks()
  await app.listen(env.PORT, '0.0.0.0')
  new Logger('Bootstrap').log(`API listening on ${env.PORT}`)
}

void bootstrap()

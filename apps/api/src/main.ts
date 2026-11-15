import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  const webOrigin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000').origin;
  app.use((request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) => {
    const origin = request.get('origin');
    if (origin && origin !== webOrigin) return response.status(403).json({ statusCode: 403, message: 'Request origin is not allowed' });
    next();
  });
  app.enableCors({ origin: webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000));
}
bootstrap();

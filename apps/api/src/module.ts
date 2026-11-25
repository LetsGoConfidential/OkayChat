import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './auth';
import { WorkspaceModule } from './workspaces';
import { CrmModule } from './crm';
import { MessagingModule } from './messaging';
import { CampaignModule } from './campaigns';
import { AutomationModule } from './automations';
import { AnalyticsModule } from './analytics';
import { TemplateModule } from './templates';
import { NotificationModule } from './notifications';
import { BillingModule } from './billing';
import { PlatformAdminModule } from './platform-admin';
import { SearchModule } from './search';

function redisConnection(rawUrl: string | undefined) {
  const redisUrl = new URL(rawUrl || 'redis://localhost:6379');
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || (redisUrl.protocol === 'rediss:' ? 6380 : 6379)),
    ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

@Controller()
class HealthController {
  @Get('health') health() { return { status: 'ok', service: 'okaychat-api', version: '0.1.0' }; }
  @Get('meta') metadata() { return { product: 'OkayChat', apiVersion: 'v1', status: 'foundation' }; }
}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), BullModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ connection: redisConnection(config.get<string>('REDIS_URL')) }) }), AuthModule, WorkspaceModule, CrmModule, MessagingModule, CampaignModule, AutomationModule, AnalyticsModule, TemplateModule, NotificationModule, BillingModule, PlatformAdminModule, SearchModule], controllers: [HealthController], providers: [{ provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }) }] })
export class AppModule {}

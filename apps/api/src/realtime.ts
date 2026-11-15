import { Controller, Injectable, MessageEvent, Module, OnModuleDestroy, OnModuleInit, Sse, UseGuards, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subscriber } from 'rxjs';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { WorkspaceGuard, WorkspaceModule } from './workspaces';

type RealtimeRequest = Request & { user: { sub: string; workspaceId: string } };

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly clients = new Map<string, Set<Subscriber<MessageEvent>>>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.subscriber = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.subscriber.on('pmessage', (_pattern, channel, raw) => {
      const workspaceId = channel.slice('okaychat:workspace:'.length);
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
      for (const client of this.clients.get(workspaceId) ?? []) client.next({ data });
    });
    this.publisher.on('error', () => undefined);
    this.subscriber.on('error', () => undefined);
  }

  async onModuleInit() {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    await this.subscriber.psubscribe('okaychat:workspace:*');
  }

  async onModuleDestroy() {
    await Promise.all([this.publisher.quit().catch(() => undefined), this.subscriber.quit().catch(() => undefined)]);
  }

  stream(workspaceId: string): Observable<MessageEvent> {
    return new Observable(observer => {
      const clients = this.clients.get(workspaceId) ?? new Set<Subscriber<MessageEvent>>();
      clients.add(observer);
      this.clients.set(workspaceId, clients);
      observer.next({ data: { type: 'ready' } });
      const heartbeat = setInterval(() => observer.next({ data: { type: 'ping' } }), 25000);
      return () => {
        clearInterval(heartbeat);
        clients.delete(observer);
        if (!clients.size) this.clients.delete(workspaceId);
      };
    });
  }

  async publish(workspaceId: string, event: Record<string, unknown>) {
    try { await this.publisher.publish(`okaychat:workspace:${workspaceId}`, JSON.stringify(event)); }
    catch { /* Persisted API work must not fail if realtime delivery is temporarily unavailable. */ }
  }
}

@Controller('realtime')
@UseGuards(AccessGuard, WorkspaceGuard)
class RealtimeController {
  constructor(private realtime: RealtimeService) {}

  @Sse('events') events(@Req() request: RealtimeRequest) {
    return this.realtime.stream(request.user.workspaceId);
  }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [RealtimeController], providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}

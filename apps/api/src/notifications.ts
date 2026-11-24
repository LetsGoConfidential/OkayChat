import { Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule } from './workspaces';

type NotificationRequest = Request & { user: { sub: string; workspaceId: string } };

@Injectable()
class NotificationService {
  constructor(private db: DatabaseService) {}

  async list(workspaceId: string, userId: string, rawLimit?: string) {
    const requested = Number.parseInt(rawLimit ?? '20', 10);
    const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : 20;
    const where = { workspaceId, userId };
    const [items, unreadCount] = await Promise.all([
      this.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      this.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async markRead(workspaceId: string, userId: string, id: string) {
    const result = await this.db.notification.updateMany({ where: { id, workspaceId, userId, readAt: null }, data: { readAt: new Date() } });
    if (!result.count && !(await this.db.notification.findFirst({ where: { id, workspaceId, userId }, select: { id: true } }))) {
      throw new NotFoundException('Notification not found');
    }
    return { success: true };
  }

  async markAllRead(workspaceId: string, userId: string) {
    const result = await this.db.notification.updateMany({ where: { workspaceId, userId, readAt: null }, data: { readAt: new Date() } });
    return { success: true, updated: result.count };
  }
}

@Controller('notifications')
@UseGuards(AccessGuard, WorkspaceGuard)
class NotificationController {
  constructor(private notifications: NotificationService) {}

  @Get()
  list(@Req() request: NotificationRequest, @Query('limit') limit?: string) {
    return this.notifications.list(request.user.workspaceId, request.user.sub, limit);
  }

  @Patch(':id/read')
  markRead(@Req() request: NotificationRequest, @Param('id') id: string) {
    return this.notifications.markRead(request.user.workspaceId, request.user.sub, id);
  }

  @Post('read-all')
  markAllRead(@Req() request: NotificationRequest) {
    return this.notifications.markAllRead(request.user.workspaceId, request.user.sub);
  }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [NotificationController], providers: [NotificationService] })
export class NotificationModule {}

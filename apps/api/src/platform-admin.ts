import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Module, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { isPlatformAdminEmail } from './platform-admin-access';

type PlatformAdminRequest = Request & { user: { sub: string } };

@Injectable()
class PlatformAdminGuard implements CanActivate {
  constructor(private db: DatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlatformAdminRequest>();
    const user = await this.db.user.findUnique({ where: { id: request.user.sub }, select: { email: true } });
    if (!user || !isPlatformAdminEmail(user.email)) throw new ForbiddenException('Platform admin access is not enabled for this account');
    return true;
  }
}

@Controller('platform-admin')
@UseGuards(AccessGuard, PlatformAdminGuard)
class PlatformAdminController {
  constructor(private db: DatabaseService) {}

  @Get('overview')
  async overview(@Req() request: PlatformAdminRequest) {
    const [workspaces, users, contacts, conversations, campaigns, latestWorkspaces] = await Promise.all([
      this.db.workspace.count(),
      this.db.user.count(),
      this.db.contact.count(),
      this.db.conversation.count(),
      this.db.campaign.count(),
      this.db.workspace.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          subscription: { select: { plan: true, status: true } },
          _count: { select: { memberships: true, contacts: true, campaigns: true } },
        },
      }),
    ]);
    await this.db.platformAdminAuditEvent.create({
      data: { actorId: request.user.sub, action: 'PLATFORM_ADMIN_OVERVIEW_READ', metadata: { workspaceCount: workspaces } },
    });
    return {
      metrics: { workspaces, users, contacts, conversations, campaigns },
      workspaces: latestWorkspaces.map(({ _count, subscription, ...workspace }) => ({
        ...workspace,
        plan: subscription?.plan ?? 'UNKNOWN',
        subscriptionStatus: subscription?.status ?? 'UNKNOWN',
        members: _count.memberships,
        contacts: _count.contacts,
        campaigns: _count.campaigns,
      })),
    };
  }
}

@Module({ imports: [AuthModule], controllers: [PlatformAdminController], providers: [PlatformAdminGuard] })
export class PlatformAdminModule {}

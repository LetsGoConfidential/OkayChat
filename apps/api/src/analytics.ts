import { Controller, Get, Injectable, Module, Req, UseGuards } from '@nestjs/common';
import { LeadStage, MessageDirection, WorkspaceRole } from '@okaychat/db';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { workspaceId: string } };
type ActivityRow = { day: Date; direction: MessageDirection; count: bigint };

@Injectable()
class AnalyticsService {
  constructor(private db: DatabaseService) {}

  async overview(workspaceId: string) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const since = new Date(today); since.setUTCDate(since.getUTCDate() - 6);
    const [conversationCount, openConversations, totalContacts, newContacts, openLeads, messageRows, leadSources] = await Promise.all([
      this.db.conversation.count({ where: { workspaceId } }),
      this.db.conversation.count({ where: { workspaceId, status: 'OPEN' } }),
      this.db.contact.count({ where: { workspaceId } }),
      this.db.contact.count({ where: { workspaceId, createdAt: { gte: since } } }),
      this.db.lead.count({ where: { workspaceId, stage: { notIn: [LeadStage.WON, LeadStage.LOST] } } }),
      this.db.$queryRaw<ActivityRow[]>`SELECT date_trunc('day', m."createdAt") AS day, m.direction::text AS direction, COUNT(*) AS count FROM "Message" m INNER JOIN "Conversation" c ON c.id = m."conversationId" WHERE c."workspaceId" = ${workspaceId} AND m."createdAt" >= ${since} GROUP BY day, m.direction ORDER BY day`,
      this.db.contact.groupBy({ by: ['source'], where: { workspaceId }, _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 8 }),
    ]);
    const activity = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(since); date.setUTCDate(date.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), inbound: 0, outbound: 0 };
    });
    for (const row of messageRows) {
      const bucket = activity.find(item => item.date === row.day.toISOString().slice(0, 10));
      if (bucket) bucket[row.direction === MessageDirection.INBOUND ? 'inbound' : 'outbound'] = Number(row.count);
    }
    return {
      period: { start: since.toISOString(), end: new Date().toISOString() },
      metrics: { conversations: conversationCount, openConversations, totalContacts, newContacts, openLeads },
      activity,
      leadSources: leadSources.map(row => ({ source: row.source || 'Unspecified', count: row._count._all })),
    };
  }
}

@Controller('analytics')
@UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)
class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}
  @Get('overview') overview(@Req() request: TenantRequest) { return this.analytics.overview(request.user.workspaceId); }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}

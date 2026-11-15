import { BadRequestException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { MetaCloudProvider, MessagingModule, TokenEncryptionService } from './messaging';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };
type ProviderTemplate = { id?: string; name: string; language: string; status: string; category?: string; components?: unknown[] };

@Injectable()
class TemplateService {
  constructor(private db: DatabaseService, private provider: MetaCloudProvider, private tokens: TokenEncryptionService) {}

  async list(workspaceId: string) {
    const channels = await this.db.channel.findMany({ where: { workspaceId }, select: { id: true, displayPhoneNumber: true } });
    const channelMap = new Map(channels.map(channel => [channel.id, channel.displayPhoneNumber]));
    const templates = await this.db.messageTemplate.findMany({ where: { channelId: { in: channels.map(channel => channel.id) } }, orderBy: [{ name: 'asc' }, { language: 'asc' }] });
    return templates.map(({ channelId, ...template }) => ({ ...template, channelId, displayPhoneNumber: channelMap.get(channelId) ?? null }));
  }

  async sync(workspaceId: string, actorId: string, channelId: string) {
    const channel = await this.db.channel.findFirst({ where: { id: channelId, workspaceId, status: 'CONNECTED' } });
    if (!channel) throw new NotFoundException('Connected WhatsApp channel not found in this workspace');
    if (!channel.businessAccountId) throw new BadRequestException('The channel is missing a WhatsApp Business Account ID');
    const templates: ProviderTemplate[] = await this.provider.listTemplates({ businessAccountId: channel.businessAccountId, accessToken: this.tokens.decrypt(channel.encryptedAccessToken) });
    let synced = 0;
    for (const template of templates) {
      if (!template.name || !template.language || !template.status) continue;
      await this.db.messageTemplate.upsert({
        where: { channelId_name_language: { channelId, name: template.name, language: template.language } },
        create: { channelId, name: template.name, language: template.language, status: template.status, category: template.category ?? null, components: (template.components ?? []) as unknown as Prisma.InputJsonValue },
        update: { status: template.status, category: template.category ?? null, components: (template.components ?? []) as unknown as Prisma.InputJsonValue, syncedAt: new Date() },
      });
      synced++;
    }
    await this.db.auditEvent.create({ data: { workspaceId, actorId, action: 'WHATSAPP_TEMPLATES_SYNCED', entityType: 'Channel', entityId: channelId, metadata: { count: synced } } });
    return { synced };
  }
}

@Controller('templates')
@UseGuards(AccessGuard, WorkspaceGuard)
class TemplateController {
  constructor(private templates: TemplateService) {}
  @Get() list(@Req() request: TenantRequest) { return this.templates.list(request.user.workspaceId); }
  @Post('sync/:channelId')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(WorkspaceRolesGuard)
  sync(@Req() request: TenantRequest, @Param('channelId') channelId: string) { return this.templates.sync(request.user.workspaceId, request.user.sub, channelId); }
}

@Module({ imports: [AuthModule, WorkspaceModule, MessagingModule], controllers: [TemplateController], providers: [TemplateService] })
export class TemplateModule {}

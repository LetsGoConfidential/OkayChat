import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { CampaignRecipientStatus, CampaignStatus, MessageDirection, MessageStatus, WorkspaceRole } from '@okaychat/db';
import { Job, Queue } from 'bullmq';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };
const CAMPAIGN_QUEUE = 'okaychat-campaign-dispatch';
const TERMINAL_RECIPIENT_STATUSES = [CampaignRecipientStatus.SENT, CampaignRecipientStatus.FAILED, CampaignRecipientStatus.SKIPPED];

class CampaignCreateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(100) templateName?: string;
  @IsOptional() @IsString() @MaxLength(20) templateLanguage?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) contactIds?: string[];
}

class CampaignUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(100) templateName?: string;
  @IsOptional() @IsString() @MaxLength(20) templateLanguage?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) contactIds?: string[];
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
}

@Injectable()
class CampaignService {
  constructor(private db: DatabaseService, @InjectQueue(CAMPAIGN_QUEUE) private queue: Queue) {}

  async list(workspaceId: string, status?: CampaignStatus) {
    return this.db.campaign.findMany({ where: { workspaceId, ...(status ? { status } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100 });
  }

  async eligibility(workspaceId: string, id: string) {
    const campaign = await this.db.campaign.findFirst({ where: { id, workspaceId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const audience = campaign.audience && typeof campaign.audience === 'object' && !Array.isArray(campaign.audience) ? campaign.audience as Record<string, unknown> : {};
    const contactIds = Array.isArray(audience.contactIds) ? [...new Set(audience.contactIds.filter((value): value is string => typeof value === 'string'))] : [];
    const contacts = contactIds.length ? await this.db.contact.findMany({ where: { workspaceId, id: { in: contactIds } }, select: { id: true, whatsappConsent: true } }) : [];
    const optedIn = contacts.filter(contact => contact.whatsappConsent === 'OPTED_IN').length;
    const optedOut = contacts.filter(contact => contact.whatsappConsent === 'OPTED_OUT').length;
    const unknown = contacts.filter(contact => contact.whatsappConsent === 'UNKNOWN').length;
    const missing = contactIds.length - contacts.length;
    const template = campaign.templateName && campaign.templateLanguage ? await this.db.messageTemplate.findFirst({
      where: { name: campaign.templateName, language: campaign.templateLanguage, status: 'APPROVED', channel: { is: { workspaceId, status: 'CONNECTED' } } },
      select: { id: true, components: true, channel: { select: { id: true, status: true } } },
    }) : null;
    const templateApproved = Boolean(template);
    const channelConnected = template?.channel.status === 'CONNECTED';
    const templateBody = Array.isArray(template?.components) ? (template.components as Array<{ type?: string; text?: string }>).find(component => component.type?.toUpperCase() === 'BODY')?.text ?? '' : '';
    const templateHasVariables = /\{\{\d+\}\}/.test(templateBody);
    const components = Array.isArray(template?.components) ? template.components as Array<{ type?: string; format?: string; text?: string }> : [];
    const templateHasUnsupportedComponents = components.some(component =>
      (component.type?.toUpperCase() === 'HEADER' && ((component.format && component.format.toUpperCase() !== 'TEXT') || /\{\{\d+\}\}/.test(component.text ?? '')))
      || (component.type?.toUpperCase() === 'BUTTONS' && /\{\{\d+\}\}/.test(JSON.stringify(component))),
    );
    const audienceEligible = contactIds.length > 0 && optedIn === contactIds.length && missing === 0;
    const readyForDispatch = audienceEligible && templateApproved && channelConnected && !templateHasVariables && !templateHasUnsupportedComponents && campaign.status === CampaignStatus.DRAFT;
    return {
      campaignId: campaign.id,
      contacts: { selected: contactIds.length, optedIn, optedOut, unknown, missing },
      template: { selected: Boolean(campaign.templateName && campaign.templateLanguage), approved: templateApproved, channelConnected },
      audienceEligible,
      readyForDispatch,
      templateHasVariables,
      templateHasUnsupportedComponents,
      campaignStatus: campaign.status,
      blockers: [
        ...(contactIds.length === 0 ? ['Select at least one contact'] : []),
        ...(optedOut > 0 ? [`${optedOut} contact(s) are opted out`] : []),
        ...(unknown > 0 ? [`${unknown} contact(s) have unknown consent`] : []),
        ...(missing > 0 ? [`${missing} contact(s) are no longer in this workspace`] : []),
        ...(!templateApproved ? ['Choose an approved WhatsApp template'] : []),
        ...(templateApproved && !channelConnected ? ['Connect the WhatsApp channel for this template'] : []),
        ...(templateHasVariables ? ['Campaign templates with body variables are not supported yet'] : []),
        ...(templateHasUnsupportedComponents ? ['Campaign templates with dynamic headers, media, or buttons are not supported yet'] : []),
        ...(campaign.status !== CampaignStatus.DRAFT ? ['Only draft campaigns can be launched'] : []),
      ],
    };
  }

  private async validateContacts(workspaceId: string, ids: string[] = []) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return uniqueIds;
    const count = await this.db.contact.count({ where: { workspaceId, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new BadRequestException('Every campaign contact must belong to this workspace');
    return uniqueIds;
  }

  private async validateTemplate(workspaceId: string, name?: string | null, language?: string | null) {
    if (!name && !language) return;
    if (!name || !language) throw new BadRequestException('Choose both a template and language');
    const template = await this.db.messageTemplate.findFirst({ where: { name, language, status: 'APPROVED', channel: { is: { workspaceId } } }, select: { id: true } });
    if (!template) throw new BadRequestException('Campaign template must be approved and synced from a channel in this workspace');
  }

  async create(workspaceId: string, actorId: string, dto: CampaignCreateDto) {
    const contactIds = await this.validateContacts(workspaceId, dto.contactIds);
    await this.validateTemplate(workspaceId, dto.templateName?.trim(), dto.templateLanguage?.trim());
    return this.db.$transaction(async tx => {
      const campaign = await tx.campaign.create({ data: { workspaceId, name: dto.name.trim(), templateName: dto.templateName?.trim() || null, templateLanguage: dto.templateLanguage?.trim() || null, audience: { type: 'CONTACTS', contactIds } } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: campaign.id } });
      return campaign;
    });
  }

  async update(workspaceId: string, actorId: string, id: string, dto: CampaignUpdateDto) {
    const current = await this.db.campaign.findFirst({ where: { id, workspaceId } });
    if (!current) throw new NotFoundException('Campaign not found');
    if (current.status !== CampaignStatus.DRAFT) throw new BadRequestException('Only draft campaigns can be edited');
    if (!Object.values(dto).some(value => value !== undefined)) throw new BadRequestException('Provide a campaign field to update');
    if (dto.status && dto.status !== CampaignStatus.DRAFT) throw new BadRequestException('Campaign sending is not enabled yet; drafts cannot be launched');
    const contactIds = dto.contactIds === undefined ? undefined : await this.validateContacts(workspaceId, dto.contactIds);
    const templateName = dto.templateName === undefined ? current.templateName : dto.templateName.trim() || null;
    const templateLanguage = dto.templateLanguage === undefined ? current.templateLanguage : dto.templateLanguage.trim() || null;
    if (dto.templateName !== undefined || dto.templateLanguage !== undefined) await this.validateTemplate(workspaceId, templateName, templateLanguage);
    return this.db.$transaction(async tx => {
      const campaign = await tx.campaign.update({ where: { id }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.templateName !== undefined || dto.templateLanguage !== undefined ? { templateName, templateLanguage } : {}),
        ...(contactIds !== undefined ? { audience: { type: 'CONTACTS', contactIds } } : {}),
      } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CAMPAIGN_UPDATED', entityType: 'Campaign', entityId: id, metadata: { changedFields: Object.keys(dto) } } });
      return campaign;
    });
  }

  async progress(workspaceId: string, id: string) {
    const campaign = await this.db.campaign.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const rows = await this.db.campaignRecipient.groupBy({ by: ['status'], where: { campaignId: id, workspaceId }, _count: { _all: true } });
    const counts = Object.fromEntries(rows.map(row => [row.status, row._count._all])) as Record<CampaignRecipientStatus, number>;
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    return {
      campaignId: id,
      status: campaign.status,
      total,
      sent: counts.SENT ?? 0,
      failed: counts.FAILED ?? 0,
      skipped: counts.SKIPPED ?? 0,
      pending: (counts.PENDING ?? 0) + (counts.QUEUED ?? 0),
    };
  }

  async dispatch(workspaceId: string, actorId: string, id: string) {
    const campaign = await this.db.campaign.findFirst({ where: { id, workspaceId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== CampaignStatus.DRAFT) throw new BadRequestException('Only draft campaigns can be launched');
    const audience = campaign.audience && typeof campaign.audience === 'object' && !Array.isArray(campaign.audience) ? campaign.audience as Record<string, unknown> : {};
    const contactIds = Array.isArray(audience.contactIds) ? [...new Set(audience.contactIds.filter((value): value is string => typeof value === 'string'))] : [];
    if (!contactIds.length) throw new BadRequestException('Select at least one contact before launching this campaign');
    if (!campaign.templateName || !campaign.templateLanguage) throw new BadRequestException('Choose an approved WhatsApp template before launching this campaign');
    const template = await this.db.messageTemplate.findFirst({
      where: { name: campaign.templateName, language: campaign.templateLanguage, status: 'APPROVED', channel: { is: { workspaceId, status: 'CONNECTED' } } },
      include: { channel: true },
      orderBy: { syncedAt: 'desc' },
    });
    if (!template) throw new BadRequestException('Campaign requires an approved template on a connected WhatsApp channel');
    const components = Array.isArray(template.components) ? template.components as Array<{ type?: string; format?: string; text?: string }> : [];
    const bodyText = components.find(component => component.type?.toUpperCase() === 'BODY')?.text ?? '';
    if (/\{\{\d+\}\}/.test(bodyText)) throw new BadRequestException('Campaign templates with body variables are not supported yet; choose a template without variables');
    const unsupported = components.some(component =>
      (component.type?.toUpperCase() === 'HEADER' && ((component.format && component.format.toUpperCase() !== 'TEXT') || /\{\{\d+\}\}/.test(component.text ?? '')))
      || (component.type?.toUpperCase() === 'BUTTONS' && /\{\{\d+\}\}/.test(JSON.stringify(component))),
    );
    if (unsupported) throw new BadRequestException('This campaign template uses dynamic header or button values that are not supported yet');
    const optedIn = await this.db.contact.findMany({ where: { workspaceId, id: { in: contactIds }, whatsappConsent: 'OPTED_IN' }, select: { id: true } });
    if (optedIn.length !== contactIds.length) throw new BadRequestException('Every selected contact must have recorded WhatsApp opt-in consent at launch');

    const startedAt = new Date();
    await this.db.$transaction(async tx => {
      const claimed = await tx.campaign.updateMany({ where: { id, workspaceId, status: CampaignStatus.DRAFT }, data: { status: CampaignStatus.RUNNING, scheduledAt: startedAt } });
      if (claimed.count !== 1) throw new BadRequestException('This campaign has already been launched');
      await tx.campaignRecipient.createMany({ data: contactIds.map(contactId => ({ workspaceId, campaignId: id, contactId })) });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CAMPAIGN_DISPATCH_STARTED', entityType: 'Campaign', entityId: id, metadata: { recipientCount: contactIds.length, templateName: template.name, language: template.language, channelId: template.channelId } } });
    }, { isolationLevel: 'Serializable' });

    try {
      await this.queue.add('dispatch-campaign', { campaignId: id, workspaceId }, { jobId: `campaign-${id}`, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 } });
    } catch {
      // The periodic dispatcher will hand off persisted pending recipients if Redis is temporarily unavailable.
    }
    return this.progress(workspaceId, id);
  }
}

type CampaignDispatchJob = { campaignId: string; workspaceId: string };

@Injectable()
class CampaignDispatchReconciler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private db: DatabaseService, @InjectQueue(CAMPAIGN_QUEUE) private queue: Queue) {}

  onModuleInit() {
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), 3000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async dispatchPending() {
    if (this.running) return;
    this.running = true;
    try {
      const campaigns = await this.db.campaign.findMany({
        where: { status: CampaignStatus.RUNNING, recipients: { some: { status: CampaignRecipientStatus.PENDING } } },
        select: { id: true, workspaceId: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      });
      for (const campaign of campaigns) {
        try {
          const jobId = `campaign-${campaign.id}`;
          const existing = await this.queue.getJob(jobId);
          if (existing) {
            const state = await existing.getState();
            if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'waiting-children') continue;
            if (state === 'failed' && Date.now() - (existing.finishedOn ?? Date.now()) < 30000) continue;
            await existing.remove();
          }
          await this.queue.add('dispatch-campaign', { campaignId: campaign.id, workspaceId: campaign.workspaceId }, { jobId, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 } });
        } catch { break; }
      }
    } catch { /* Persisted pending recipients are retried by the next reconciliation pass. */ }
    finally { this.running = false; }
  }
}

@Processor(CAMPAIGN_QUEUE, { concurrency: 2 })
class CampaignDispatchProcessor extends WorkerHost {
  constructor(private db: DatabaseService) { super(); }

  async process(job: Job<CampaignDispatchJob>) {
    const { campaignId, workspaceId } = job.data;
    const campaign = await this.db.campaign.findFirst({ where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING } });
    if (!campaign) return { skipped: true };

    while (true) {
      const recipients = await this.db.campaignRecipient.findMany({
        where: { campaignId, workspaceId, status: CampaignRecipientStatus.PENDING },
        include: { contact: { select: { id: true, phone: true, whatsappConsent: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 25,
      });
      if (!recipients.length) break;

      for (const recipient of recipients) {
        if (recipient.contact.whatsappConsent !== 'OPTED_IN') {
          await this.db.campaignRecipient.updateMany({ where: { id: recipient.id, workspaceId, status: CampaignRecipientStatus.PENDING }, data: { status: CampaignRecipientStatus.SKIPPED, error: 'Consent was withdrawn before dispatch.' } });
          continue;
        }
        const template = campaign.templateName && campaign.templateLanguage ? await this.db.messageTemplate.findFirst({
          where: { name: campaign.templateName, language: campaign.templateLanguage, status: 'APPROVED', channel: { is: { workspaceId, status: 'CONNECTED' } } },
          include: { channel: { select: { id: true } } },
          orderBy: { syncedAt: 'desc' },
        }) : null;
        if (!template) {
          await this.db.campaignRecipient.updateMany({ where: { id: recipient.id, workspaceId, status: CampaignRecipientStatus.PENDING }, data: { status: CampaignRecipientStatus.FAILED, error: 'Approved template or connected channel is no longer available.' } });
          continue;
        }
        const components = Array.isArray(template.components) ? template.components as Array<{ type?: string; format?: string; text?: string }> : [];
        const body = components.find(component => component.type?.toUpperCase() === 'BODY')?.text ?? '';
        const unsupported = /\{\{\d+\}\}/.test(body) || components.some(component =>
          (component.type?.toUpperCase() === 'HEADER' && ((component.format && component.format.toUpperCase() !== 'TEXT') || /\{\{\d+\}\}/.test(component.text ?? '')))
          || (component.type?.toUpperCase() === 'BUTTONS' && /\{\{\d+\}\}/.test(JSON.stringify(component))),
        );
        if (unsupported) {
          await this.db.campaignRecipient.updateMany({ where: { id: recipient.id, workspaceId, status: CampaignRecipientStatus.PENDING }, data: { status: CampaignRecipientStatus.FAILED, error: 'This campaign template uses unsupported dynamic components.' } });
          continue;
        }

        let conversation = await this.db.conversation.findFirst({ where: { workspaceId, contactId: recipient.contactId, channelId: template.channel.id } });
        if (!conversation) conversation = await this.db.conversation.create({ data: { workspaceId, contactId: recipient.contactId, channelId: template.channel.id } });
        const idempotencyKey = `campaign:${campaignId}:${recipient.contactId}`;
        try {
          await this.db.$transaction(async tx => {
            const claimed = await tx.campaignRecipient.updateMany({ where: { id: recipient.id, workspaceId, status: CampaignRecipientStatus.PENDING }, data: { status: CampaignRecipientStatus.QUEUED } });
            if (claimed.count !== 1) return;
            const message = await tx.message.create({ data: {
              conversationId: conversation!.id,
              direction: MessageDirection.OUTBOUND,
              status: MessageStatus.QUEUED,
              type: 'TEMPLATE',
              body: body || `[Campaign: ${campaign.name}]`,
              idempotencyKey,
              payload: { templateName: template.name, language: template.language, bodyParameters: [], campaignId, campaignRecipientId: recipient.id },
            } });
            await tx.outboundOutbox.create({ data: { messageId: message.id, workspaceId, actorId: null } });
            await tx.campaignRecipient.update({ where: { id: recipient.id, workspaceId }, data: { messageId: message.id } });
          }, { isolationLevel: 'Serializable' });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
          const existingMessage = await this.db.message.findFirst({ where: { conversationId: conversation.id, idempotencyKey }, select: { id: true } });
          if (!existingMessage) throw error;
          await this.db.campaignRecipient.updateMany({ where: { id: recipient.id, workspaceId, status: CampaignRecipientStatus.PENDING }, data: { status: CampaignRecipientStatus.QUEUED, messageId: existingMessage.id } });
        }
      }
    }
    const pending = await this.db.campaignRecipient.count({ where: { campaignId, workspaceId, status: CampaignRecipientStatus.PENDING } });
    if (!pending) await this.completeIfDrained(campaignId, workspaceId);
    return { campaignId, pending };
  }

  async completeIfDrained(campaignId: string, workspaceId: string) {
    const unfinished = await this.db.campaignRecipient.count({ where: { campaignId, workspaceId, status: { in: [CampaignRecipientStatus.PENDING, CampaignRecipientStatus.QUEUED] } } });
    if (!unfinished) await this.db.campaign.updateMany({ where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING }, data: { status: CampaignStatus.COMPLETED } });
  }
}

@Controller('campaigns')
@UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)
class CampaignController {
  constructor(private campaigns: CampaignService) {}
  @Get() list(@Req() request: TenantRequest, @Query('status') status?: CampaignStatus) {
    if (status && !Object.values(CampaignStatus).includes(status)) throw new BadRequestException('Invalid campaign status');
    return this.campaigns.list(request.user.workspaceId, status);
  }
  @Get(':id/eligibility') eligibility(@Req() request: TenantRequest, @Param('id') id: string) { return this.campaigns.eligibility(request.user.workspaceId, id); }
  @Get(':id/progress') progress(@Req() request: TenantRequest, @Param('id') id: string) { return this.campaigns.progress(request.user.workspaceId, id); }
  @Post(':id/dispatch') dispatch(@Req() request: TenantRequest, @Param('id') id: string) { return this.campaigns.dispatch(request.user.workspaceId, request.user.sub, id); }
  @Post() create(@Req() request: TenantRequest, @Body() dto: CampaignCreateDto) { return this.campaigns.create(request.user.workspaceId, request.user.sub, dto); }
  @Patch(':id') update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: CampaignUpdateDto) { return this.campaigns.update(request.user.workspaceId, request.user.sub, id, dto); }
}

@Module({ imports: [AuthModule, WorkspaceModule, BullModule.registerQueue({ name: CAMPAIGN_QUEUE })], controllers: [CampaignController], providers: [CampaignService, CampaignDispatchProcessor, CampaignDispatchReconciler] })
export class CampaignModule {}

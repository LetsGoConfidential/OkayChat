import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CampaignStatus, WorkspaceRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };

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
  constructor(private db: DatabaseService) {}

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
      where: { name: campaign.templateName, language: campaign.templateLanguage, status: 'APPROVED', channel: { is: { workspaceId } } },
      select: { id: true, channel: { select: { status: true } } },
    }) : null;
    const templateApproved = Boolean(template);
    const channelConnected = template?.channel.status === 'CONNECTED';
    const audienceEligible = contactIds.length > 0 && optedIn === contactIds.length && missing === 0;
    return {
      campaignId: campaign.id,
      contacts: { selected: contactIds.length, optedIn, optedOut, unknown, missing },
      template: { selected: Boolean(campaign.templateName && campaign.templateLanguage), approved: templateApproved, channelConnected },
      audienceEligible,
      readyForDispatch: false,
      blockers: [
        ...(contactIds.length === 0 ? ['Select at least one contact'] : []),
        ...(optedOut > 0 ? [`${optedOut} contact(s) are opted out`] : []),
        ...(unknown > 0 ? [`${unknown} contact(s) have unknown consent`] : []),
        ...(missing > 0 ? [`${missing} contact(s) are no longer in this workspace`] : []),
        ...(!templateApproved ? ['Choose an approved WhatsApp template'] : []),
        ...(templateApproved && !channelConnected ? ['Connect the WhatsApp channel for this template'] : []),
        'Campaign dispatch is not enabled yet',
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
  @Post() create(@Req() request: TenantRequest, @Body() dto: CampaignCreateDto) { return this.campaigns.create(request.user.workspaceId, request.user.sub, dto); }
  @Patch(':id') update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: CampaignUpdateDto) { return this.campaigns.update(request.user.workspaceId, request.user.sub, id, dto); }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [CampaignController], providers: [CampaignService] })
export class CampaignModule {}

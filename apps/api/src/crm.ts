import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsEnum, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { LeadStage, WhatsappConsent, WorkspaceRole } from '@prisma/client';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };

class ContactCreateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must use international format, such as +14155552671' }) phone!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(80) source?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}
class ContactUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(80) source?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsEnum(WhatsappConsent) whatsappConsent?: WhatsappConsent;
  @IsOptional() @IsString() @MaxLength(240) whatsappConsentSource?: string;
}
class ContactImportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsObject({ each: true }) rows!: Record<string, unknown>[];
}
class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit = 25;
}
class LeadCreateDto {
  @IsString() @MinLength(1) @MaxLength(40) contactId!: string;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
}
class LeadUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?: string;
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
}

@Injectable()
class CrmService {
  constructor(private db: DatabaseService) {}

  async contacts(workspaceId: string, query: ListQueryDto) {
    const limit = Math.min(Number(query.limit) || 25, 100);
    if (query.cursor && !(await this.db.contact.findFirst({ where: { id: query.cursor, workspaceId }, select: { id: true } }))) throw new BadRequestException('Invalid contact cursor');
    const q = query.q?.trim();
    const where = { workspaceId, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }, { email: { contains: q, mode: 'insensitive' as const } }, { company: { contains: q, mode: 'insensitive' as const } }] } : {}) };
    const rows = await this.db.contact.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: limit + 1 });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  }

  async createContact(workspaceId: string, actorId: string, dto: ContactCreateDto) {
    try {
      return await this.db.$transaction(async tx => {
        const contact = await tx.contact.create({ data: { workspaceId, name: dto.name.trim(), phone: dto.phone, email: dto.email?.trim().toLowerCase(), company: dto.company?.trim(), source: dto.source?.trim(), tags: dto.tags ?? [] } });
        await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CONTACT_CREATED', entityType: 'Contact', entityId: contact.id } });
        return contact;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A contact with this phone number already exists in this workspace');
      throw error;
    }
  }

  async importContacts(workspaceId: string, actorId: string, rows: Record<string, unknown>[]) {
    const issues: { row: number; reason: string }[] = [];
    const phonesInFile = new Set<string>();
    const normalized: { row: number; name: string; phone: string; email: string | null; company: string | null; source: string | null; tags: string[] }[] = [];
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    rows.forEach((input, index) => {
      const row = index + 2;
      if (!input || typeof input !== 'object' || Array.isArray(input)) { issues.push({ row, reason: 'Contact row must be an object' }); return; }
      if (input.email != null && typeof input.email !== 'string') { issues.push({ row, reason: 'Email must be text' }); return; }
      if (input.company != null && typeof input.company !== 'string') { issues.push({ row, reason: 'Company must be text' }); return; }
      if (input.source != null && typeof input.source !== 'string') { issues.push({ row, reason: 'Source must be text' }); return; }
      if (input.tags != null && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(tag => typeof tag !== 'string' || tag.length > 80))) { issues.push({ row, reason: 'Use up to 20 text tags per contact, each at most 80 characters' }); return; }
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
      const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim().toLowerCase() : null;
      const company = typeof input.company === 'string' && input.company.trim() ? input.company.trim() : null;
      const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim() : 'CSV import';
      const rawTags = Array.isArray(input.tags) ? input.tags : [];
      const tags = [...new Set(rawTags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
      if (!name || name.length > 120) { issues.push({ row, reason: 'Name is required and must be at most 120 characters' }); return; }
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) { issues.push({ row, reason: 'Phone must be in international format, for example +14155552671' }); return; }
      if (email && (email.length > 254 || !emailPattern.test(email))) { issues.push({ row, reason: 'Email address is invalid' }); return; }
      if (company && company.length > 160) { issues.push({ row, reason: 'Company must be at most 160 characters' }); return; }
      if (source.length > 80) { issues.push({ row, reason: 'Source must be at most 80 characters' }); return; }
      if (phonesInFile.has(phone)) { issues.push({ row, reason: 'Phone number is duplicated in this file' }); return; }
      phonesInFile.add(phone);
      normalized.push({ row, name, phone, email, company, source, tags });
    });
    const existing = new Set((await this.db.contact.findMany({ where: { workspaceId, phone: { in: normalized.map(row => row.phone) } }, select: { phone: true } })).map(contact => contact.phone));
    const candidates = normalized.filter(row => {
      if (!existing.has(row.phone)) return true;
      issues.push({ row: row.row, reason: 'Phone number already exists in this workspace' });
      return false;
    });
    const result = await this.db.$transaction(async tx => {
      const imported = candidates.length ? (await tx.contact.createMany({ data: candidates.map(({ name, phone, email, company, source, tags }) => ({ workspaceId, name, phone, email, company, source, tags })), skipDuplicates: true })).count : 0;
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CONTACTS_IMPORTED', entityType: 'Contact', metadata: { submitted: rows.length, imported, skipped: rows.length - imported, issueCount: issues.length } } });
      return imported;
    });
    const raceSkips = Math.max(0, candidates.length - result);
    if (raceSkips) issues.push({ row: 0, reason: `${raceSkips} contact(s) were skipped because they were added concurrently` });
    return { submitted: rows.length, imported: result, skipped: rows.length - result, issues };
  }

  async updateContact(workspaceId: string, actorId: string, id: string, dto: ContactUpdateDto) {
    const current = await this.db.contact.findFirst({ where: { id, workspaceId } });
    if (!current) throw new NotFoundException('Contact not found');
    if (!Object.values(dto).some(value => value !== undefined)) throw new BadRequestException('Provide at least one contact field to update');
    const consentChanged = dto.whatsappConsent !== undefined;
    const consentSource = dto.whatsappConsentSource?.trim() || null;
    if (consentChanged && dto.whatsappConsent !== WhatsappConsent.UNKNOWN && !consentSource) throw new BadRequestException('Add where this WhatsApp consent was recorded');
    if (consentChanged && dto.whatsappConsent === WhatsappConsent.UNKNOWN && !consentSource) throw new BadRequestException('Add a note explaining why consent status was reset');
    if (!consentChanged && dto.whatsappConsentSource !== undefined) throw new BadRequestException('Change the consent status when updating its source');
    try {
      return await this.db.$transaction(async tx => {
        const contact = await tx.contact.update({ where: { id }, data: { ...dto, name: dto.name?.trim(), email: dto.email?.trim().toLowerCase(), company: dto.company?.trim(), source: dto.source?.trim(), ...(consentChanged ? { whatsappConsentAt: new Date(), whatsappConsentSource: consentSource } : {}) } });
        await tx.auditEvent.create({ data: { workspaceId, actorId, action: consentChanged ? 'CONTACT_WHATSAPP_CONSENT_UPDATED' : 'CONTACT_UPDATED', entityType: 'Contact', entityId: id, metadata: { changedFields: Object.keys(dto), ...(consentChanged ? { previousConsent: current.whatsappConsent, whatsappConsent: dto.whatsappConsent, whatsappConsentSource: consentSource } : {}) } } });
        return contact;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A contact with this phone number already exists in this workspace');
      throw error;
    }
  }

  async leads(workspaceId: string, query: ListQueryDto) {
    const limit = Math.min(Number(query.limit) || 25, 100);
    if (query.cursor && !(await this.db.lead.findFirst({ where: { id: query.cursor, workspaceId }, select: { id: true } }))) throw new BadRequestException('Invalid lead cursor');
    const q = query.q?.trim();
    const rows = await this.db.lead.findMany({ where: { workspaceId, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { contact: { name: { contains: q, mode: 'insensitive' as const } } }, { contact: { phone: { contains: q } } }] } : {}) }, include: { contact: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: limit + 1 });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  }

  async createLead(workspaceId: string, actorId: string, dto: LeadCreateDto) {
    const contact = await this.db.contact.findFirst({ where: { id: dto.contactId, workspaceId }, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found in this workspace');
    return this.db.$transaction(async tx => {
      const lead = await tx.lead.create({ data: { workspaceId, contactId: contact.id, title: dto.title.trim(), stage: dto.stage ?? LeadStage.NEW, value: dto.value } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'LEAD_CREATED', entityType: 'Lead', entityId: lead.id } });
      return lead;
    });
  }

  async updateLead(workspaceId: string, actorId: string, id: string, dto: LeadUpdateDto) {
    const current = await this.db.lead.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!current) throw new NotFoundException('Lead not found');
    if (!Object.values(dto).some(value => value !== undefined)) throw new BadRequestException('Provide at least one lead field to update');
    return this.db.$transaction(async tx => {
      const lead = await tx.lead.update({ where: { id }, data: { ...dto, title: dto.title?.trim() }, include: { contact: true } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'LEAD_UPDATED', entityType: 'Lead', entityId: id, metadata: { changedFields: Object.keys(dto) } } });
      return lead;
    });
  }
}

@Controller('contacts')
@UseGuards(AccessGuard, WorkspaceGuard)
class ContactsController {
  constructor(private crm: CrmService) {}
  @Get() list(@Req() request: TenantRequest, @Query() query: ListQueryDto) { return this.crm.contacts(request.user.workspaceId, query); }
  @Post() create(@Req() request: TenantRequest, @Body() dto: ContactCreateDto) { return this.crm.createContact(request.user.workspaceId, request.user.sub, dto); }
  @Post('import') import(@Req() request: TenantRequest, @Body() dto: ContactImportDto) { return this.crm.importContacts(request.user.workspaceId, request.user.sub, dto.rows); }
  @Patch(':id') @UseGuards(WorkspaceRolesGuard) @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER) update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: ContactUpdateDto) { return this.crm.updateContact(request.user.workspaceId, request.user.sub, id, dto); }
}

@Controller('leads')
@UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)
class LeadsController {
  constructor(private crm: CrmService) {}
  @Get() list(@Req() request: TenantRequest, @Query() query: ListQueryDto) { return this.crm.leads(request.user.workspaceId, query); }
  @Post() create(@Req() request: TenantRequest, @Body() dto: LeadCreateDto) { return this.crm.createLead(request.user.workspaceId, request.user.sub, dto); }
  @Patch(':id') update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: LeadUpdateDto) { return this.crm.updateLead(request.user.workspaceId, request.user.sub, id, dto); }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [ContactsController, LeadsController], providers: [CrmService] })
export class CrmModule {}

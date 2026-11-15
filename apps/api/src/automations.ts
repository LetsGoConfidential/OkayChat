import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { WorkspaceRole } from '@okaychat/db';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };
class AutomationCreateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(40) assigneeId!: string;
}
class AutomationUpdateDto { @IsOptional() @IsBoolean() enabled?: boolean; }

@Injectable()
class AutomationService {
  constructor(private db: DatabaseService) {}
  list(workspaceId: string) { return this.db.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } }); }
  async create(workspaceId: string, actorId: string, dto: AutomationCreateDto) {
    const member = await this.db.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: dto.assigneeId } }, select: { id: true } });
    if (!member) throw new BadRequestException('Assignee must be a member of this workspace');
    return this.db.$transaction(async tx => {
      const automation = await tx.automation.create({ data: { workspaceId, name: dto.name.trim(), enabled: true, trigger: { type: 'INBOUND_WHATSAPP_MESSAGE' }, actions: [{ type: 'ASSIGN_CONVERSATION', userId: dto.assigneeId }] } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'AUTOMATION_CREATED', entityType: 'Automation', entityId: automation.id } });
      return automation;
    });
  }
  async update(workspaceId: string, actorId: string, id: string, dto: AutomationUpdateDto) {
    if (dto.enabled === undefined) throw new BadRequestException('Provide enabled state to update');
    const current = await this.db.automation.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!current) throw new NotFoundException('Automation not found');
    return this.db.$transaction(async tx => {
      const automation = await tx.automation.update({ where: { id }, data: { enabled: dto.enabled } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: dto.enabled ? 'AUTOMATION_ENABLED' : 'AUTOMATION_DISABLED', entityType: 'Automation', entityId: id } });
      return automation;
    });
  }
}

@Controller('automations')
@UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)
class AutomationController {
  constructor(private service: AutomationService) {}
  @Get() list(@Req() request: TenantRequest) { return this.service.list(request.user.workspaceId); }
  @Post() create(@Req() request: TenantRequest, @Body() dto: AutomationCreateDto) { return this.service.create(request.user.workspaceId, request.user.sub, dto); }
  @Patch(':id') update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: AutomationUpdateDto) { return this.service.update(request.user.workspaceId, request.user.sub, id, dto); }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [AutomationController], providers: [AutomationService] })
export class AutomationModule {}

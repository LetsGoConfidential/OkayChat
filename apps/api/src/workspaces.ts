import { BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext, Get, Injectable, Module, Param, Patch, Post, Query, Req, Res, SetMetadata, UnauthorizedException, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsEnum, IsOptional, IsString, IsTimeZone, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { WorkspaceRole } from '@okaychat/db';
import { createHash, randomBytes } from 'node:crypto';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { TrimInput } from './input-normalization';

type RequestUser = { sub: string; workspaceId: string; role: WorkspaceRole; sessionId: string };
type WorkspaceRequest = Request & { user: RequestUser; membership?: { id: string; workspaceId: string; userId: string; role: WorkspaceRole } };

class UpdateWorkspaceDto {
  @IsOptional() @TrimInput() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @IsTimeZone() timezone?: string;
}
class CreateWorkspaceDto { @TrimInput() @IsString() @MinLength(2) @MaxLength(120) name!: string; }
class CreateWorkspaceInviteDto {
  @TrimInput() @IsEmail() @MaxLength(254) email!: string;
  @IsEnum(WorkspaceRole) role!: WorkspaceRole;
}
class AcceptWorkspaceInviteDto { @IsString() @MinLength(32) @MaxLength(128) token!: string; }

export const WorkspaceRoles = (...roles: WorkspaceRole[]) => SetMetadata('workspace_roles', roles);

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private db: DatabaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.user?.sub || !request.user?.workspaceId) throw new UnauthorizedException('Workspace context required');
    const membership = await this.db.membership.findUnique({ where: { workspaceId_userId: { workspaceId: request.user.workspaceId, userId: request.user.sub } } });
    if (!membership) throw new ForbiddenException('You no longer have access to this workspace');
    request.membership = membership;
    return true;
  }
}

@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<WorkspaceRole[]>('workspace_roles', [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.membership || !roles.includes(request.membership.role)) throw new ForbiddenException('Your workspace role cannot perform this action');
    return true;
  }
}

@Controller('workspaces')
class WorkspaceController {
  constructor(private db: DatabaseService, private jwt: JwtService) {}

  @Get()
  @UseGuards(AccessGuard)
  async list(@Req() request: WorkspaceRequest) {
    const memberships = await this.db.membership.findMany({ where: { userId: request.user.sub }, include: { workspace: true }, orderBy: { createdAt: 'asc' } });
    return memberships.map(({ role, workspace }) => ({ id: workspace.id, name: workspace.name, slug: workspace.slug, timezone: workspace.timezone, role }));
  }

  @Get('current')
  @UseGuards(AccessGuard, WorkspaceGuard)
  async current(@Req() request: WorkspaceRequest) {
    const workspace = await this.db.workspace.findUnique({ where: { id: request.membership!.workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return { ...workspace, role: request.membership!.role };
  }

  @Get('current/members')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER)
  @UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
  async members(@Req() request: WorkspaceRequest) {
    const members = await this.db.membership.findMany({ where: { workspaceId: request.membership!.workspaceId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    return members.map(({ id, role, createdAt, user }) => ({ id, role, joinedAt: createdAt, user }));
  }

  @Get('current/invites')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
  async invites(@Req() request: WorkspaceRequest) {
    return this.db.workspaceInvite.findMany({
      where: { workspaceId: request.membership!.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('current/invites')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
  async createInvite(@Body() dto: CreateWorkspaceInviteDto, @Req() request: WorkspaceRequest) {
    const workspaceId = request.membership!.workspaceId;
    const role = request.membership!.role;
    const email = dto.email.trim().toLowerCase();
    if (dto.role === WorkspaceRole.OWNER || (dto.role === WorkspaceRole.ADMIN && role !== WorkspaceRole.OWNER)) throw new ForbiddenException('Only the workspace owner can invite an admin');
    const existingUser = await this.db.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser && await this.db.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: existingUser.id } }, select: { id: true } })) throw new ConflictException('This person is already a workspace member');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let invitation;
    try {
      invitation = await this.db.$transaction(async tx => {
        const current = await tx.workspaceInvite.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
        if (current && !current.acceptedAt && !current.revokedAt && current.expiresAt > new Date()) throw new ConflictException('A valid invitation already exists for this email');
        const created = current
          ? await tx.workspaceInvite.update({ where: { id: current.id }, data: { role: dto.role, tokenHash, createdById: request.user.sub, expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date() } })
          : await tx.workspaceInvite.create({ data: { workspaceId, email, role: dto.role, tokenHash, createdById: request.user.sub, expiresAt } });
        await tx.auditEvent.create({ data: { workspaceId, actorId: request.user.sub, action: 'WORKSPACE_INVITE_CREATED', entityType: 'WorkspaceInvite', entityId: created.id, metadata: { email, role: dto.role, expiresAt: expiresAt.toISOString() } } });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002' || code === 'P2034') throw new ConflictException('An invitation for this email was changed at the same time. Refresh the team list and try again.');
      throw error;
    }
    const inviteUrl = new URL('/invite/accept', process.env.WEB_ORIGIN || 'http://localhost:3000');
    inviteUrl.searchParams.set('token', token);
    return { id: invitation.id, email: invitation.email, role: invitation.role, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, inviteUrl: inviteUrl.toString() };
  }

  @Post('current/invites/:inviteId/revoke')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
  async revokeInvite(@Param('inviteId') inviteId: string, @Req() request: WorkspaceRequest) {
    const workspaceId = request.membership!.workspaceId;
    const revokedAt = new Date();
    const result = await this.db.workspaceInvite.updateMany({ where: { id: inviteId, workspaceId, acceptedAt: null, revokedAt: null }, data: { revokedAt } });
    if (!result.count) throw new NotFoundException('Pending invitation not found');
    await this.db.auditEvent.create({ data: { workspaceId, actorId: request.user.sub, action: 'WORKSPACE_INVITE_REVOKED', entityType: 'WorkspaceInvite', entityId: inviteId } });
    return { success: true };
  }

  @Post('invites/accept')
  @UseGuards(AccessGuard)
  async acceptInvite(@Body() dto: AcceptWorkspaceInviteDto, @Req() request: WorkspaceRequest, @Res({ passthrough: true }) response: Response) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();
    const user = await this.db.user.findUnique({ where: { id: request.user.sub }, select: { id: true, email: true } });
    if (!user) throw new UnauthorizedException('Account not found');
    const invitation = await this.db.workspaceInvite.findUnique({ where: { tokenHash }, include: { workspace: true } });
    if (!invitation || invitation.email !== user.email.toLowerCase() || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) throw new ForbiddenException('This invitation is invalid, expired, revoked, or belongs to another email address');
    const session = await this.db.session.findFirst({ where: { id: request.user.sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: now } } });
    if (!session) throw new UnauthorizedException('Session expired. Please sign in again.');
    await this.db.$transaction(async tx => {
      const claimed = await tx.workspaceInvite.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
      if (claimed.count !== 1) throw new ConflictException('This invitation has already been used');
      await tx.membership.create({ data: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role } });
      await tx.session.update({ where: { id: session.id }, data: { activeWorkspaceId: invitation.workspaceId } });
      await tx.auditEvent.create({ data: { workspaceId: invitation.workspaceId, actorId: user.id, action: 'WORKSPACE_INVITE_ACCEPTED', entityType: 'WorkspaceInvite', entityId: invitation.id, metadata: { role: invitation.role } } });
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, workspaceId: invitation.workspaceId, role: invitation.role, sessionId: session.id });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `okaychat_access=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`);
    return { workspace: { id: invitation.workspace.id, name: invitation.workspace.name, slug: invitation.workspace.slug, timezone: invitation.workspace.timezone }, role: invitation.role };
  }

  @Get('invites/preview')
  @UseGuards(AccessGuard)
  async previewInvite(@Query('token') token: string, @Req() request: WorkspaceRequest) {
    if (!token || token.length < 32 || token.length > 128) throw new BadRequestException('A valid invitation token is required');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.db.workspaceInvite.findUnique({ where: { tokenHash }, include: { workspace: { select: { name: true, slug: true } } } });
    const user = await this.db.user.findUnique({ where: { id: request.user.sub }, select: { email: true } });
    if (!invitation || !user || invitation.email !== user.email.toLowerCase() || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) throw new ForbiddenException('This invitation is invalid, expired, revoked, or belongs to another email address');
    return { workspaceName: invitation.workspace.name, workspaceSlug: invitation.workspace.slug, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt };
  }

  @Patch('current')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
  async update(@Body() dto: UpdateWorkspaceDto, @Req() request: WorkspaceRequest) {
    if (!dto.name && !dto.timezone) throw new BadRequestException('Provide a workspace name or timezone to update');
    const workspaceId = request.membership!.workspaceId;
    const workspace = await this.db.workspace.update({ where: { id: workspaceId }, data: dto });
    await this.db.auditEvent.create({ data: { workspaceId, actorId: request.user.sub, action: 'WORKSPACE_UPDATED', entityType: 'Workspace', entityId: workspaceId, metadata: { name: dto.name ?? null, timezone: dto.timezone ?? null } } });
    return { ...workspace, role: request.membership!.role };
  }

  @Post()
  @UseGuards(AccessGuard)
  async create(@Body() dto: CreateWorkspaceDto, @Req() request: WorkspaceRequest, @Res({ passthrough: true }) response: Response) {
    const slugBase = dto.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'workspace';
    const workspace = await this.db.$transaction(async tx => {
      const created = await tx.workspace.create({ data: { name: dto.name.trim(), slug: `${slugBase}-${randomBytes(3).toString('hex')}`, subscription: { create: {} } } });
      await tx.membership.create({ data: { workspaceId: created.id, userId: request.user.sub, role: WorkspaceRole.OWNER } });
      await tx.auditEvent.create({ data: { workspaceId: created.id, actorId: request.user.sub, action: 'WORKSPACE_CREATED', entityType: 'Workspace', entityId: created.id } });
      return created;
    });
    return this.activateWorkspace(workspace.id, request, response);
  }

  @Post(':workspaceId/activate')
  @UseGuards(AccessGuard)
  async activate(@Param('workspaceId') workspaceId: string, @Req() request: WorkspaceRequest, @Res({ passthrough: true }) response: Response) {
    return this.activateWorkspace(workspaceId, request, response);
  }

  private async activateWorkspace(workspaceId: string, request: WorkspaceRequest, response: Response) {
    const membership = await this.db.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: request.user.sub } }, include: { workspace: true } });
    if (!membership) throw new ForbiddenException('You are not a member of this workspace');
    const session = await this.db.session.findFirst({ where: { id: request.user.sessionId, userId: request.user.sub, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!session) throw new UnauthorizedException('Session expired. Please sign in again.');
    await this.db.session.update({ where: { id: session.id }, data: { activeWorkspaceId: workspaceId } });
    await this.db.auditEvent.create({ data: { workspaceId, actorId: request.user.sub, action: 'WORKSPACE_ACTIVATED', entityType: 'Workspace', entityId: workspaceId } });
    const accessToken = await this.jwt.signAsync({ sub: request.user.sub, workspaceId, role: membership.role, sessionId: session.id });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `okaychat_access=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`);
    return { workspace: { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug, timezone: membership.workspace.timezone }, role: membership.role };
  }
}

@Module({ imports: [AuthModule], controllers: [WorkspaceController], providers: [WorkspaceGuard, WorkspaceRolesGuard], exports: [WorkspaceGuard, WorkspaceRolesGuard] })
export class WorkspaceModule {}

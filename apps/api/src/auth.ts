import { Body, Controller, ExecutionContext, Get, Injectable, Module, Post, Req, Res, UnauthorizedException, UseGuards, ConflictException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from './database';
import { isPlatformAdminEmail } from './platform-admin-access';
import { TrimInput } from './input-normalization';

class RegisterDto {
  @TrimInput() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @TrimInput() @IsEmail() email!: string;
  @MinLength(10) password!: string;
  @IsOptional() @TrimInput() @IsString() @MinLength(2) @MaxLength(120) workspaceName?: string;
  @IsOptional() @IsString() @MinLength(32) @MaxLength(128) inviteToken?: string;
}
class LoginDto { @TrimInput() @IsEmail() email!: string; @IsString() @IsNotEmpty() password!: string; }
class RefreshDto { @IsString() @IsNotEmpty() refreshToken!: string; }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
class AuthService {
  constructor(private db: DatabaseService, private jwt: JwtService) {}

  private async issue(userId: string, workspaceId?: string) {
    const membership = await this.db.membership.findFirst({ where: { userId, ...(workspaceId ? { workspaceId } : {}) }, include: { workspace: true }, orderBy: { createdAt: 'asc' } });
    if (!membership) throw new UnauthorizedException('No workspace membership found');
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await this.db.session.create({ data: { userId, activeWorkspaceId: membership.workspaceId, refreshHash: hashToken(refreshToken), expiresAt } });
    const accessToken = await this.jwt.signAsync({ sub: userId, workspaceId: membership.workspaceId, role: membership.role, sessionId: session.id });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true } });
    return { accessToken, refreshToken, user, workspace: { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug }, role: membership.role };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.db.user.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists');
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    if (dto.inviteToken) {
      const now = new Date();
      const invite = await this.db.workspaceInvite.findUnique({ where: { tokenHash: hashToken(dto.inviteToken) }, include: { workspace: true } });
      if (!invite || invite.email !== email || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= now) throw new ConflictException('This invitation is invalid or expired');
      const created = await this.db.$transaction(async tx => {
        const user = await tx.user.create({ data: { email, name: dto.name.trim(), passwordHash } });
        const claimed = await tx.workspaceInvite.updateMany({ where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
        if (claimed.count !== 1) throw new ConflictException('This invitation is no longer available');
        await tx.membership.create({ data: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role } });
        await tx.auditEvent.create({ data: { workspaceId: invite.workspaceId, actorId: user.id, action: 'workspace.invite.accepted', entityType: 'workspaceInvite', entityId: invite.id, metadata: { email, role: invite.role } } });
        return user;
      });
      const tokens = await this.issue(created.id, invite.workspaceId);
      return { ...tokens, user: { id: created.id, name: created.name, email: created.email }, workspace: { id: invite.workspace.id, name: invite.workspace.name, slug: invite.workspace.slug } };
    }
    if (!dto.workspaceName?.trim()) throw new ConflictException('Business name is required');
    const workspaceName = dto.workspaceName.trim();
    const slugBase = workspaceName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'workspace';
    const slug = `${slugBase}-${randomBytes(3).toString('hex')}`;
    const created = await this.db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: dto.name.trim(), passwordHash } });
      const workspace = await tx.workspace.create({ data: { name: workspaceName, slug, subscription: { create: {} } } });
      await tx.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' } });
      return { user, workspace };
    });
    const tokens = await this.issue(created.user.id, created.workspace.id);
    return { ...tokens, user: { id: created.user.id, name: created.user.name, email: created.user.email }, workspace: { id: created.workspace.id, name: created.workspace.name, slug: created.workspace.slug } };
  }

  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) throw new UnauthorizedException('Email or password is incorrect');
    const tokens = await this.issue(user.id);
    return { ...tokens, user: { id: user.id, name: user.name, email: user.email } };
  }

  async refresh(dto: RefreshDto) {
    const refreshHash = hashToken(dto.refreshToken);
    const session = await this.db.session.findUnique({ where: { refreshHash } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Session expired. Please sign in again.');
    const consumed = await this.db.session.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (consumed.count !== 1) throw new UnauthorizedException('Session expired. Please sign in again.');
    return this.issue(session.userId, session.activeWorkspaceId);
  }

  async logout(refreshToken?: string) {
    if (refreshToken) await this.db.session.updateMany({ where: { refreshHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }
}

@Injectable()
export class AccessGuard {
  constructor(private jwt: JwtService, private db: DatabaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('okaychat_access='))?.slice('okaychat_access='.length);
    if (!token) throw new UnauthorizedException('Authentication required');
    try { request.user = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('Session expired. Please sign in again.'); }
    const claims = request.user;
    if (typeof claims?.sub !== 'string' || typeof claims?.sessionId !== 'string' || typeof claims?.workspaceId !== 'string') {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const session = await this.db.session.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.sub,
        activeWorkspaceId: claims.workspaceId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('Session expired. Please sign in again.');
    return true;
  }
}

@Controller('auth')
class AuthController {
  constructor(private auth: AuthService, private db: DatabaseService) {}
  private async withCookies(tokens: any, response: Response) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', [
      `okaychat_access=${tokens.accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure}`,
      `okaychat_refresh=${tokens.refreshToken}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800${secure}`,
    ]);
    const { accessToken: _accessToken, refreshToken: _refreshToken, ...publicData } = tokens;
    return publicData;
  }
  @Post('register') async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) { return this.withCookies(await this.auth.register(dto), response); }
  @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) { return this.withCookies(await this.auth.login(dto), response); }
  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('okaychat_refresh='))?.slice('okaychat_refresh='.length);
    if (!token) throw new UnauthorizedException('Session expired. Please sign in again.');
    return this.withCookies(await this.auth.refresh({ refreshToken: decodeURIComponent(token) }), response);
  }
  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('okaychat_refresh='))?.slice('okaychat_refresh='.length);
    await this.auth.logout(token ? decodeURIComponent(token) : undefined);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader('Set-Cookie', [`okaychat_access=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`, `okaychat_refresh=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0${secure}`]);
    return { success: true };
  }
  @Get('me') @UseGuards(AccessGuard) async me(@Req() req: Request & { user: any }) {
    const membership = await this.db.membership.findFirst({ where: { userId: req.user.sub, workspaceId: req.user.workspaceId }, include: { user: true, workspace: true } });
    if (!membership) throw new UnauthorizedException();
    return { user: { id: membership.user.id, name: membership.user.name, email: membership.user.email }, workspace: { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug }, role: membership.role, platformAdmin: isPlatformAdminEmail(membership.user.email) };
  }
}

@Module({ imports: [JwtModule.registerAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), signOptions: { expiresIn: '15m', issuer: 'okaychat.in', audience: 'okaychat-web' } }) })], controllers: [AuthController], providers: [AuthService, AccessGuard, DatabaseService], exports: [JwtModule, AccessGuard, DatabaseService] })
export class AuthModule {}

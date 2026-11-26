import { BadRequestException, Controller, Get, Module, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { searchQueryValidationError } from './search-query';
import { WorkspaceGuard, WorkspaceModule } from './workspaces';

type SearchRequest = Request & { user: { workspaceId: string } };

@Controller('search')
@UseGuards(AccessGuard, WorkspaceGuard)
class SearchController {
  constructor(private db: DatabaseService) {}

  @Get()
  async search(@Req() request: SearchRequest, @Query('q') rawQuery?: string) {
    const q = rawQuery?.trim() ?? '';
    const validationError = searchQueryValidationError(rawQuery);
    if (validationError) throw new BadRequestException(validationError);
    const workspaceId = request.user.workspaceId;
    const contains = { contains: q, mode: 'insensitive' as const };
    const [contacts, leads, conversations] = await Promise.all([
      this.db.contact.findMany({
        where: { workspaceId, OR: [{ name: contains }, { phone: { contains: q } }, { email: contains }, { company: contains }] },
        select: { id: true, name: true, phone: true, company: true },
        orderBy: { createdAt: 'desc' }, take: 6,
      }),
      this.db.lead.findMany({
        where: { workspaceId, OR: [{ title: contains }, { contact: { name: contains } }, { contact: { phone: { contains: q } } }] },
        select: { id: true, title: true, stage: true, contact: { select: { name: true, phone: true } } },
        orderBy: { updatedAt: 'desc' }, take: 6,
      }),
      this.db.conversation.findMany({
        where: { workspaceId, OR: [{ contact: { name: contains } }, { contact: { phone: { contains: q } } }, { messages: { some: { body: contains } } }] },
        select: { id: true, status: true, contact: { select: { name: true, phone: true } }, messages: { select: { body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { lastMessageAt: 'desc' }, take: 6,
      }),
    ]);
    return { query: q, contacts, leads, conversations };
  }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [SearchController] })
export class SearchModule {}

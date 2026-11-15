import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Injectable, InternalServerErrorException, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Query, RawBodyRequest, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ArrayMaxSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CampaignRecipientStatus, CampaignStatus, Channel, ConversationStatus, MessageDirection, MessageStatus, WorkspaceRole } from '@okaychat/db';
import { Request, Response } from 'express';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';
import { RealtimeModule, RealtimeService } from './realtime';

type TenantRequest = Request & { user: { sub: string; workspaceId: string } };
type MetaMessageResponse = { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } };
export const OUTBOUND_QUEUE = 'okaychat-outbound-messages';

interface SendTextInput { phoneNumberId: string; accessToken: string; recipient: string; body: string }
interface SendTextResult { providerMessageId: string }
interface WhatsAppProvider { sendText(input: SendTextInput): Promise<SendTextResult> }
type TemplateSendInput = { phoneNumberId: string; accessToken: string; recipient: string; templateName: string; language: string; bodyParameters: string[] };

@Injectable()
export class TokenEncryptionService {
  private key() {
    const encoded = process.env.TOKEN_ENCRYPTION_KEY;
    const key = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) throw new InternalServerErrorException('TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
    return key;
  }
  encrypt(plaintext: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  decrypt(value: string) {
    const [version, ivPart, tagPart, encryptedPart] = value.split('.');
    if (version !== 'v1' || !ivPart || !tagPart || !encryptedPart) throw new InternalServerErrorException('Stored WhatsApp credential has an unsupported format');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivPart, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new InternalServerErrorException('Stored WhatsApp credential could not be decrypted'); }
  }
}

@Injectable()
export class MetaCloudProvider implements WhatsAppProvider {
  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const version = (process.env.META_GRAPH_API_VERSION || 'v23.0').replace(/^\/+/, '');
    const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(input.phoneNumberId)}/messages`;
    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: input.recipient.replace(/^\+/, ''), type: 'text', text: { body: input.body, preview_url: false } }) });
    } catch { throw new BadGatewayException('Could not reach the WhatsApp provider'); }
    const result = await response.json().catch(() => ({})) as MetaMessageResponse;
    const id = result.messages?.[0]?.id;
    if (!response.ok || !id) throw new BadGatewayException(result.error?.message || 'WhatsApp did not accept the message');
    return { providerMessageId: id };
  }

  async listTemplates(input: { businessAccountId: string; accessToken: string }) {
    const version = (process.env.META_GRAPH_API_VERSION || 'v23.0').replace(/^\/+/, '');
    const templates: Array<{ id?: string; name: string; language: string; status: string; category?: string; components?: unknown[] }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ fields: 'id,name,language,status,category,components', limit: '100' });
      if (cursor) params.set('after', cursor);
      let response: globalThis.Response;
      try { response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(input.businessAccountId)}/message_templates?${params}`, { headers: { Authorization: `Bearer ${input.accessToken}` } }); }
      catch { throw new BadGatewayException('Could not reach the WhatsApp template service'); }
      const result = await response.json().catch(() => ({})) as { data?: Array<{ id?: string; name: string; language: string; status: string; category?: string; components?: unknown[] }>; paging?: { cursors?: { after?: string } }; error?: { message?: string } };
      if (!response.ok) throw new BadGatewayException(result.error?.message || 'Could not sync WhatsApp templates');
      templates.push(...(result.data ?? []));
      const next = result.paging?.cursors?.after;
      if (!next || next === cursor || !(result.data?.length)) break;
      cursor = next;
    }
    return templates;
  }

  async sendTemplate(input: TemplateSendInput): Promise<SendTextResult> {
    const version = (process.env.META_GRAPH_API_VERSION || 'v23.0').replace(/^\/+/, '');
    const components = input.bodyParameters.length ? [{ type: 'body', parameters: input.bodyParameters.map(text => ({ type: 'text', text })) }] : [];
    const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(input.phoneNumberId)}/messages`;
    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: input.recipient.replace(/^\+/, ''), type: 'template', template: { name: input.templateName, language: { code: input.language }, ...(components.length ? { components } : {}) } }) });
    } catch { throw new BadGatewayException('Could not reach the WhatsApp provider'); }
    const result = await response.json().catch(() => ({})) as MetaMessageResponse;
    const id = result.messages?.[0]?.id;
    if (!response.ok || !id) throw new BadGatewayException(result.error?.message || 'WhatsApp did not accept the template message');
    return { providerMessageId: id };
  }
}

class ChannelConnectDto {
  @IsString() @IsNotEmpty() @MaxLength(100) phoneNumberId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) businessAccountId!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) displayPhoneNumber!: string;
  @IsString() @MinLength(20) @MaxLength(4096) accessToken!: string;
}
class SendMessageDto { @IsString() @MinLength(1) @MaxLength(4096) body!: string; }
class SendTemplateDto {
  @IsString() @MinLength(1) @MaxLength(100) templateName!: string;
  @IsString() @MinLength(2) @MaxLength(20) language!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1024, { each: true }) bodyParameters?: string[];
}
class ConversationQueryDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
class ConversationUpdateDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) assignedTo?: string;
}
class ConversationNoteCreateDto { @IsString() @MinLength(1) @MaxLength(2000) body!: string; }

@Injectable()
class MessagingService {
  constructor(private db: DatabaseService, @InjectQueue(OUTBOUND_QUEUE) private outboundQueue: Queue, private realtime: RealtimeService, private tokens: TokenEncryptionService) {}

  async channels(workspaceId: string) {
    return this.db.channel.findMany({ where: { workspaceId }, select: { id: true, provider: true, phoneNumberId: true, businessAccountId: true, displayPhoneNumber: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  }

  async connectChannel(workspaceId: string, actorId: string, dto: ChannelConnectDto) {
    try {
      return await this.db.$transaction(async tx => {
        const channel = await tx.channel.create({ data: { workspaceId, phoneNumberId: dto.phoneNumberId.trim(), businessAccountId: dto.businessAccountId.trim(), displayPhoneNumber: dto.displayPhoneNumber.trim(), encryptedAccessToken: this.tokens.encrypt(dto.accessToken), status: 'CONNECTED' } });
        await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'WHATSAPP_CHANNEL_CONNECTED', entityType: 'Channel', entityId: channel.id, metadata: { phoneNumberId: channel.phoneNumberId } } });
        return { id: channel.id, provider: channel.provider, phoneNumberId: channel.phoneNumberId, businessAccountId: channel.businessAccountId, displayPhoneNumber: channel.displayPhoneNumber, status: channel.status, createdAt: channel.createdAt };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('That WhatsApp phone number is already connected');
      throw error;
    }
  }

  async conversations(workspaceId: string, query: ConversationQueryDto) {
    const q = query.q?.trim();
    return this.db.conversation.findMany({ where: { workspaceId, ...(query.status ? { status: query.status } : {}), ...(q ? { contact: { name: { contains: q, mode: 'insensitive' } } } : {}) }, include: { contact: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { lastMessageAt: 'desc' }, take: 100 });
  }

  async updateConversation(workspaceId: string, actorId: string, id: string, dto: ConversationUpdateDto) {
    const existing = await this.db.conversation.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Conversation not found');
    if (!dto.status && dto.assignedTo === undefined) throw new BadRequestException('Provide a status or assignee to update');
    if (dto.assignedTo && !(await this.db.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: dto.assignedTo } }, select: { id: true } }))) throw new BadRequestException('Assignee must be a member of this workspace');
    const conversation = await this.db.$transaction(async tx => {
      const conversation = await tx.conversation.update({ where: { id }, data: dto, include: { contact: true } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CONVERSATION_UPDATED', entityType: 'Conversation', entityId: id, metadata: { status: dto.status ?? null, assignedTo: dto.assignedTo ?? null } } });
      return conversation;
    });
    await this.realtime.publish(workspaceId, { type: 'inbox.changed', conversationId: id });
    return conversation;
  }

  async messages(workspaceId: string, conversationId: string, cursor?: string) {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (cursor && !(await this.db.message.findFirst({ where: { id: cursor, conversationId }, select: { id: true } }))) throw new BadRequestException('Invalid message cursor');
    const rows = await this.db.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 51 });
    const hasMore = rows.length > 50; const items = rows.slice(0, 50).reverse();
    return { items, nextCursor: hasMore ? rows[49]?.id ?? null : null };
  }

  async notes(workspaceId: string, conversationId: string) {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const rows = await this.db.conversationNote.findMany({ where: { workspaceId, conversationId }, include: { author: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    return rows.reverse();
  }

  async createNote(workspaceId: string, actorId: string, conversationId: string, body: string) {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const content = body.trim();
    if (!content) throw new BadRequestException('Note cannot be empty');
    const note = await this.db.$transaction(async tx => {
      const created = await tx.conversationNote.create({ data: { workspaceId, conversationId, authorId: actorId, body: content }, include: { author: { select: { id: true, name: true } } } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'CONVERSATION_NOTE_CREATED', entityType: 'ConversationNote', entityId: created.id, metadata: { conversationId } } });
      return created;
    });
    await this.realtime.publish(workspaceId, { type: 'inbox.changed', conversationId });
    return note;
  }

  async sendText(workspaceId: string, actorId: string, conversationId: string, body: string, idempotencyKey: string | undefined) {
    if (!idempotencyKey || idempotencyKey.length > 100) throw new BadRequestException('A valid Idempotency-Key header is required');
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const previous = await this.db.message.findFirst({ where: { conversationId, idempotencyKey } });
    if (previous) return previous;
    const lastInbound = await this.db.message.findFirst({ where: { conversationId, direction: MessageDirection.INBOUND }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (!lastInbound || Date.now() - lastInbound.createdAt.getTime() > 24 * 60 * 60 * 1000) throw new BadRequestException('The customer service window is closed. Use an approved WhatsApp template to contact this customer.');
    if (!conversation.channelId) throw new BadRequestException('This conversation has no WhatsApp channel attached');
    const channel = await this.db.channel.findFirst({ where: { id: conversation.channelId, workspaceId, status: 'CONNECTED' } });
    if (!channel) throw new NotFoundException('Connected WhatsApp channel not found');
    let queued;
    try {
      queued = await this.db.$transaction(async tx => {
        const message = await tx.message.create({ data: { conversationId, direction: MessageDirection.OUTBOUND, status: MessageStatus.QUEUED, type: 'TEXT', body: body.trim(), idempotencyKey } });
        await tx.outboundOutbox.create({ data: { messageId: message.id, workspaceId, actorId } });
        await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'MESSAGE_QUEUED', entityType: 'Message', entityId: message.id } });
        return message;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return this.db.message.findFirstOrThrow({ where: { conversationId, idempotencyKey } });
      throw error;
    }
    return this.enqueueOutbound(queued, workspaceId, actorId);
  }

  async sendTemplate(workspaceId: string, actorId: string, conversationId: string, dto: SendTemplateDto, idempotencyKey: string | undefined) {
    if (!idempotencyKey || idempotencyKey.length > 100) throw new BadRequestException('A valid Idempotency-Key header is required');
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const previous = await this.db.message.findFirst({ where: { conversationId, idempotencyKey } });
    if (previous) return previous;
    if (!conversation.channelId) throw new BadRequestException('This conversation has no WhatsApp channel attached');
    const channel = await this.db.channel.findFirst({ where: { id: conversation.channelId, workspaceId, status: 'CONNECTED' } });
    if (!channel) throw new NotFoundException('Connected WhatsApp channel not found');
    const template = await this.db.messageTemplate.findFirst({ where: { channelId: channel.id, name: dto.templateName, language: dto.language, status: 'APPROVED' } });
    if (!template) throw new BadRequestException('Choose an approved, synced template for this WhatsApp channel');
    const components = Array.isArray(template.components) ? (template.components as unknown as Array<{ type?: string; format?: string; text?: string }>).filter(component => Boolean(component && typeof component === 'object')) : [];
    const bodyText = components.find(component => component.type?.toUpperCase() === 'BODY')?.text ?? '';
    const placeholders = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
    const parameterIndexes = [...new Set(placeholders.map(match => Number(match[1])))].sort((a, b) => a - b);
    const requiredParameters = parameterIndexes.at(-1) ?? 0;
    if (parameterIndexes.some((index, position) => index !== position + 1)) throw new BadRequestException('This template has non-sequential body variables and cannot be sent yet');
    const bodyParameters = dto.bodyParameters ?? [];
    if (requiredParameters !== bodyParameters.length) throw new BadRequestException(`This template requires ${requiredParameters} body parameter(s)`);
    const unsupported = components.some(component => (component.type?.toUpperCase() === 'HEADER' && ((component.format && component.format.toUpperCase() !== 'TEXT') || /\{\{\d+\}\}/.test(component.text ?? ''))) || (component.type?.toUpperCase() === 'BUTTONS' && /\{\{\d+\}\}/.test(JSON.stringify(component))));
    if (unsupported) throw new BadRequestException('This template uses dynamic header or button values, which are not supported by this sender yet');
    const preview = bodyText.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => bodyParameters[Number(index) - 1] ?? '');
    let queued;
    try { queued = await this.db.$transaction(async tx => {
      const message = await tx.message.create({ data: { conversationId, direction: MessageDirection.OUTBOUND, status: MessageStatus.QUEUED, type: 'TEMPLATE', body: preview || `[Template: ${template.name}]`, idempotencyKey, payload: { templateName: template.name, language: template.language, bodyParameters } } });
      await tx.outboundOutbox.create({ data: { messageId: message.id, workspaceId, actorId } });
      await tx.auditEvent.create({ data: { workspaceId, actorId, action: 'MESSAGE_QUEUED', entityType: 'Message', entityId: message.id } });
      return message;
    }); }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') return this.db.message.findFirstOrThrow({ where: { conversationId, idempotencyKey } });
      throw error;
    }
    return this.enqueueOutbound(queued, workspaceId, actorId);
  }

  private async enqueueOutbound(message: { id: string; conversationId: string }, workspaceId: string, actorId: string) {
    try {
      await this.outboundQueue.add('deliver-message', { messageId: message.id, workspaceId, actorId }, { jobId: message.id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: { age: 604800 } });
      await this.db.outboundOutbox.updateMany({ where: { messageId: message.id, status: 'PENDING' }, data: { status: 'ENQUEUED' } });
    } catch { /* The database outbox dispatcher will retry the Redis handoff. */ }
    await this.realtime.publish(workspaceId, { type: 'inbox.changed', conversationId: message.conversationId, messageId: message.id });
    return this.db.message.findUniqueOrThrow({ where: { id: message.id } });
  }

  async receiveWebhook(payload: any) {
    const changes = (payload?.entry ?? []).flatMap((entry: any) => entry?.changes ?? []);
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const channel = await this.db.channel.findUnique({ where: { phoneNumberId } });
      if (!channel || channel.status !== 'CONNECTED') continue;
      for (const status of value?.statuses ?? []) await this.applyStatus(status);
      for (const incoming of value?.messages ?? []) {
        const profileName = value?.contacts?.find((contact: any) => contact?.wa_id === incoming?.from)?.profile?.name;
        await this.applyIncoming(channel, incoming, profileName);
      }
    }
    return { received: true };
  }

  private async applyStatus(status: any) {
    const states: Record<string, MessageStatus> = { sent: MessageStatus.SENT, delivered: MessageStatus.DELIVERED, read: MessageStatus.READ, failed: MessageStatus.FAILED };
    const mapped = states[status?.status];
    if (!mapped || !status?.id) return;
    const messages = await this.db.message.findMany({ where: { providerId: status.id }, select: { id: true, payload: true, conversation: { select: { workspaceId: true } } } });
    if (!messages.length) return;
    await this.db.message.updateMany({ where: { id: { in: messages.map(message => message.id) } }, data: { status: mapped, ...(status.status === 'failed' ? { payload: { failure: JSON.stringify(status.errors ?? []).slice(0, 800) } } : {}) } });
    await this.db.outboundOutbox.updateMany({ where: { messageId: { in: messages.map(message => message.id) } }, data: status.status === 'failed' ? { status: 'FAILED', lastError: JSON.stringify(status.errors ?? []).slice(0, 400) } : { status: 'COMPLETED', lastError: null } });
    if (status.status === 'failed') {
      for (const message of messages) {
        const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload) ? message.payload as Record<string, unknown> : {};
        const campaignRecipientId = typeof payload.campaignRecipientId === 'string' ? payload.campaignRecipientId : null;
        if (!campaignRecipientId) continue;
        await this.db.campaignRecipient.updateMany({ where: { id: campaignRecipientId, workspaceId: message.conversation.workspaceId, status: { in: [CampaignRecipientStatus.QUEUED, CampaignRecipientStatus.SENT] } }, data: { status: CampaignRecipientStatus.FAILED, error: JSON.stringify(status.errors ?? []).slice(0, 400) || 'WhatsApp delivery failed' } });
        const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : null;
        if (campaignId) await this.completeCampaignIfDrained(campaignId, message.conversation.workspaceId);
      }
    }
    for (const workspaceId of new Set(messages.map(message => message.conversation.workspaceId))) await this.realtime.publish(workspaceId, { type: 'inbox.changed', messageId: messages[0].id });
  }

  private async completeCampaignIfDrained(campaignId: string, workspaceId: string) {
    const unfinished = await this.db.campaignRecipient.count({ where: { campaignId, workspaceId, status: { in: [CampaignRecipientStatus.PENDING, CampaignRecipientStatus.QUEUED] } } });
    if (!unfinished) await this.db.campaign.updateMany({ where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING }, data: { status: CampaignStatus.COMPLETED } });
  }

  private async applyIncoming(channel: Channel, incoming: any, profileName?: string) {
    if (!incoming?.id || !incoming?.from) return;
    if (await this.db.message.findUnique({ where: { providerId: incoming.id }, select: { id: true } })) return;
    const rawPhone = String(incoming.from);
    const phone = rawPhone.startsWith('+') || !/^\d+$/.test(rawPhone) ? rawPhone : `+${rawPhone}`;
    const contact = await this.db.contact.upsert({ where: { workspaceId_phone: { workspaceId: channel.workspaceId, phone } }, create: { workspaceId: channel.workspaceId, name: profileName?.slice(0, 120) || phone, phone, source: 'WhatsApp' }, update: profileName ? { name: profileName.slice(0, 120) } : {} });
    let conversation = await this.db.conversation.findFirst({ where: { workspaceId: channel.workspaceId, contactId: contact.id, channelId: channel.id } });
    const sentAt = incoming.timestamp ? new Date(Number(incoming.timestamp) * 1000) : new Date();
    if (!conversation) conversation = await this.db.conversation.create({ data: { workspaceId: channel.workspaceId, contactId: contact.id, channelId: channel.id, lastMessageAt: sentAt } });
    const text = incoming.text?.body ?? (incoming.type ? `[${String(incoming.type)} message]` : '');
    try {
      await this.db.message.create({ data: { conversationId: conversation.id, providerId: incoming.id, direction: MessageDirection.INBOUND, status: MessageStatus.DELIVERED, type: String(incoming.type ?? 'unknown').toUpperCase(), body: text, payload: incoming } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return;
    }
    await this.db.conversation.updateMany({ where: { id: conversation.id, lastMessageAt: { lt: sentAt } }, data: { lastMessageAt: sentAt } });
    await this.applyInboundAssignmentAutomation(channel.workspaceId, conversation.id);
    await this.realtime.publish(channel.workspaceId, { type: 'inbox.changed', conversationId: conversation.id, messageId: incoming.id });
  }

  private async applyInboundAssignmentAutomation(workspaceId: string, conversationId: string) {
    const rules = await this.db.automation.findMany({ where: { workspaceId, enabled: true }, select: { id: true, trigger: true, actions: true } });
    for (const rule of rules) {
      const trigger = rule.trigger as { type?: string };
      const actions = rule.actions as Array<{ type?: string; userId?: string }>;
      if (trigger?.type !== 'INBOUND_WHATSAPP_MESSAGE' || !Array.isArray(actions)) continue;
      for (const action of actions) {
        if (action?.type !== 'ASSIGN_CONVERSATION' || !action.userId) continue;
        const assigned = await this.db.conversation.updateMany({ where: { id: conversationId, workspaceId, assignedTo: null }, data: { assignedTo: action.userId } });
        if (assigned.count) {
          await this.db.auditEvent.create({ data: { workspaceId, action: 'CONVERSATION_AUTO_ASSIGNED', entityType: 'Conversation', entityId: conversationId, metadata: { automationId: rule.id, assigneeId: action.userId } } });
          return;
        }
      }
    }
  }
}

type OutboundJobData = { messageId: string; workspaceId: string; actorId: string | null };

@Injectable()
class OutboundOutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private db: DatabaseService, @InjectQueue(OUTBOUND_QUEUE) private queue: Queue) {}

  onModuleInit() {
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), 2500);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async dispatchPending() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.db.outboundOutbox.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50 });
      for (const item of pending) {
        try {
          await this.queue.add('deliver-message', { messageId: item.messageId, workspaceId: item.workspaceId, actorId: item.actorId }, { jobId: item.messageId, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: { age: 604800 } });
          await this.db.outboundOutbox.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { status: 'ENQUEUED', lastError: null } });
        } catch (error) {
          await this.db.outboundOutbox.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { lastError: error instanceof Error ? error.message.slice(0, 400) : 'Redis handoff failed' } }).catch(() => undefined);
          break;
        }
      }
      const stale = await this.db.outboundOutbox.findMany({ where: { status: 'ENQUEUED', updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) }, message: { status: MessageStatus.QUEUED } }, orderBy: { updatedAt: 'asc' }, take: 25 });
      for (const item of stale) {
        try {
          const existing = await this.queue.getJob(item.messageId);
          if (!existing) {
            await this.queue.add('deliver-message', { messageId: item.messageId, workspaceId: item.workspaceId, actorId: item.actorId }, { jobId: item.messageId, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: { age: 604800 } });
          }
          await this.db.outboundOutbox.updateMany({ where: { id: item.id, status: 'ENQUEUED' }, data: { updatedAt: new Date() } });
        } catch { /* Keep the enqueued record for the next reconciliation pass. */ }
      }
    } catch { /* Keep the API alive; the next poll retries database or Redis failures. */ }
    finally { this.running = false; }
  }
}

@Processor(OUTBOUND_QUEUE, { concurrency: 8 })
class OutboundMessageProcessor extends WorkerHost {
  constructor(private db: DatabaseService, private tokens: TokenEncryptionService, private provider: MetaCloudProvider, private realtime: RealtimeService) { super(); }

  async process(job: Job<OutboundJobData>) {
    const message = await this.db.message.findUnique({ where: { id: job.data.messageId }, include: { conversation: { include: { contact: true } } } });
    if (!message || message.status !== MessageStatus.QUEUED) return { skipped: true };
    const conversation = message.conversation;
    const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload) ? message.payload as Record<string, unknown> : {};
    const campaignRecipientId = typeof payload.campaignRecipientId === 'string' ? payload.campaignRecipientId : null;
    if (campaignRecipientId) {
      const recipient = await this.db.campaignRecipient.findFirst({ where: { id: campaignRecipientId, workspaceId: job.data.workspaceId }, include: { contact: { select: { whatsappConsent: true } } } });
      if (!recipient || recipient.status !== CampaignRecipientStatus.QUEUED || recipient.contact.whatsappConsent !== 'OPTED_IN') {
        const reason = recipient ? 'Consent was withdrawn before provider delivery.' : 'Campaign recipient is no longer available; delivery was cancelled.';
        await this.db.message.update({ where: { id: message.id }, data: { status: MessageStatus.FAILED, payload: { ...payload, failure: reason } } });
        await this.db.outboundOutbox.updateMany({ where: { messageId: message.id }, data: { status: 'FAILED', lastError: reason } });
        if (recipient) await this.db.campaignRecipient.updateMany({ where: { id: campaignRecipientId, workspaceId: job.data.workspaceId, status: CampaignRecipientStatus.QUEUED }, data: { status: CampaignRecipientStatus.SKIPPED, error: reason } });
        if (typeof payload.campaignId === 'string') await this.completeCampaignIfDrained(payload.campaignId, job.data.workspaceId);
        await this.realtime.publish(job.data.workspaceId, { type: 'inbox.changed', conversationId: conversation.id, messageId: message.id });
        return { skipped: true, reason };
      }
    }
    if (!conversation.channelId) throw new Error('Conversation has no connected WhatsApp channel');
    const channel = await this.db.channel.findFirst({ where: { id: conversation.channelId, workspaceId: job.data.workspaceId, status: 'CONNECTED' } });
    if (!channel) throw new Error('Connected WhatsApp channel not found');
    let providerMessageId: string;
    try {
      if (message.type === 'TEMPLATE') {
        const templateName = typeof payload.templateName === 'string' ? payload.templateName : '';
        const language = typeof payload.language === 'string' ? payload.language : '';
        const bodyParameters = Array.isArray(payload.bodyParameters) ? payload.bodyParameters.filter((value): value is string => typeof value === 'string') : [];
        if (!templateName || !language) throw new Error('Template details are missing from the queued message');
        const template = await this.db.messageTemplate.findFirst({ where: { channelId: channel.id, name: templateName, language, status: 'APPROVED' }, select: { id: true } });
        if (!template) throw new Error('Template is no longer approved on this WhatsApp channel');
        const sent = await this.provider.sendTemplate({ phoneNumberId: channel.phoneNumberId, accessToken: this.tokens.decrypt(channel.encryptedAccessToken), recipient: conversation.contact.phone, templateName, language, bodyParameters });
        providerMessageId = sent.providerMessageId;
      } else {
        if (!message.body) throw new Error('Message text is missing');
        const sent = await this.provider.sendText({ phoneNumberId: channel.phoneNumberId, accessToken: this.tokens.decrypt(channel.encryptedAccessToken), recipient: conversation.contact.phone, body: message.body });
        providerMessageId = sent.providerMessageId;
      }
    } catch (cause) {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (finalAttempt) {
        const oldPayload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload) ? message.payload as Record<string, unknown> : {};
        await this.db.message.update({ where: { id: message.id }, data: { status: MessageStatus.FAILED, payload: { ...oldPayload, failure: cause instanceof Error ? cause.message.slice(0, 400) : 'Provider error' } } });
        await this.db.outboundOutbox.updateMany({ where: { messageId: message.id }, data: { status: 'FAILED', lastError: cause instanceof Error ? cause.message.slice(0, 400) : 'Provider error' } });
        if (campaignRecipientId) {
          await this.db.campaignRecipient.updateMany({ where: { id: campaignRecipientId, workspaceId: job.data.workspaceId, status: CampaignRecipientStatus.QUEUED }, data: { status: CampaignRecipientStatus.FAILED, error: cause instanceof Error ? cause.message.slice(0, 400) : 'Provider error' } });
          if (typeof payload.campaignId === 'string') await this.completeCampaignIfDrained(payload.campaignId, job.data.workspaceId);
        }
        await this.realtime.publish(job.data.workspaceId, { type: 'inbox.changed', conversationId: conversation.id, messageId: message.id });
      }
      throw cause instanceof Error ? cause : new Error('WhatsApp delivery failed');
    }
    const sentMessage = await this.db.message.update({ where: { id: message.id }, data: { status: MessageStatus.SENT, providerId: providerMessageId } });
    await this.db.outboundOutbox.updateMany({ where: { messageId: message.id }, data: { status: 'COMPLETED', lastError: null } });
    if (campaignRecipientId) {
      await this.db.campaignRecipient.updateMany({ where: { id: campaignRecipientId, workspaceId: job.data.workspaceId, status: CampaignRecipientStatus.QUEUED }, data: { status: CampaignRecipientStatus.SENT, error: null } });
      if (typeof payload.campaignId === 'string') await this.completeCampaignIfDrained(payload.campaignId, job.data.workspaceId);
    }
    await this.db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    await this.db.auditEvent.create({ data: { workspaceId: job.data.workspaceId, actorId: job.data.actorId, action: message.type === 'TEMPLATE' ? 'MESSAGE_TEMPLATE_SENT' : 'MESSAGE_SENT', entityType: 'Message', entityId: message.id, metadata: { conversationId: conversation.id, providerMessageId } } });
    await this.realtime.publish(job.data.workspaceId, { type: 'inbox.changed', conversationId: conversation.id, messageId: message.id });
    return { messageId: sentMessage.id, providerMessageId };
  }

  private async completeCampaignIfDrained(campaignId: string, workspaceId: string) {
    const unfinished = await this.db.campaignRecipient.count({ where: { campaignId, workspaceId, status: { in: [CampaignRecipientStatus.PENDING, CampaignRecipientStatus.QUEUED] } } });
    if (!unfinished) await this.db.campaign.updateMany({ where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING }, data: { status: CampaignStatus.COMPLETED } });
  }
}

@Controller('channels')
@UseGuards(AccessGuard, WorkspaceGuard)
class ChannelsController {
  constructor(private messaging: MessagingService) {}
  @Get() list(@Req() request: TenantRequest) { return this.messaging.channels(request.user.workspaceId); }
  @Post('whatsapp/connect')
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @UseGuards(WorkspaceRolesGuard)
  connect(@Req() request: TenantRequest, @Body() dto: ChannelConnectDto) { return this.messaging.connectChannel(request.user.workspaceId, request.user.sub, dto); }
}

@Controller('conversations')
@UseGuards(AccessGuard, WorkspaceGuard)
class ConversationsController {
  constructor(private messaging: MessagingService) {}
  @Get() list(@Req() request: TenantRequest, @Query() query: ConversationQueryDto) { return this.messaging.conversations(request.user.workspaceId, query); }
  @Patch(':id') update(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: ConversationUpdateDto) { return this.messaging.updateConversation(request.user.workspaceId, request.user.sub, id, dto); }
  @Get(':id/messages') listMessages(@Req() request: TenantRequest, @Param('id') id: string, @Query('cursor') cursor?: string) { return this.messaging.messages(request.user.workspaceId, id, cursor); }
  @Get(':id/notes') listNotes(@Req() request: TenantRequest, @Param('id') id: string) { return this.messaging.notes(request.user.workspaceId, id); }
  @Post(':id/notes') createNote(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: ConversationNoteCreateDto) { return this.messaging.createNote(request.user.workspaceId, request.user.sub, id, dto.body); }
  @Post(':id/messages') send(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: SendMessageDto, @Headers('idempotency-key') key?: string) { return this.messaging.sendText(request.user.workspaceId, request.user.sub, id, dto.body, key); }
  @Post(':id/template') sendTemplate(@Req() request: TenantRequest, @Param('id') id: string, @Body() dto: SendTemplateDto, @Headers('idempotency-key') key?: string) { return this.messaging.sendTemplate(request.user.workspaceId, request.user.sub, id, dto, key); }
}

@Controller('webhooks/meta')
class MetaWebhookController {
  constructor(private messaging: MessagingService) {}
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() response: Response) {
    if (mode !== 'subscribe' || !token || token !== process.env.META_WEBHOOK_VERIFY_TOKEN) throw new ForbiddenException('Webhook verification failed');
    return response.status(200).type('text/plain').send(challenge);
  }
  @Post()
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string) {
    const secret = process.env.META_APP_SECRET; const rawBody = request.rawBody;
    if (!secret || !rawBody || !signature?.startsWith('sha256=')) throw new UnauthorizedException('Webhook signature is required');
    const received = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new UnauthorizedException('Invalid webhook signature');
    return this.messaging.receiveWebhook(request.body);
  }
}

@Module({ imports: [AuthModule, WorkspaceModule, RealtimeModule, BullModule.registerQueue({ name: OUTBOUND_QUEUE })], controllers: [ChannelsController, ConversationsController, MetaWebhookController], providers: [MessagingService, OutboundMessageProcessor, OutboundOutboxDispatcher, TokenEncryptionService, MetaCloudProvider], exports: [TokenEncryptionService, MetaCloudProvider] })
export class MessagingModule {}

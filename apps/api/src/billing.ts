import { Controller, Get, Injectable, InternalServerErrorException, Module, Req, UseGuards } from '@nestjs/common';
import { BillingPlan, WorkspaceRole } from '@okaychat/db';
import { Request } from 'express';
import { AccessGuard, AuthModule } from './auth';
import { DatabaseService } from './database';
import { WorkspaceGuard, WorkspaceModule, WorkspaceRoles, WorkspaceRolesGuard } from './workspaces';

type BillingRequest = Request & { user: { workspaceId: string } };

const PLAN_CATALOG = [
  { id: BillingPlan.FREE, name: 'Free', monthlyPriceInr: 0, priceLabel: '₹0', features: ['Shared inbox and contacts', 'Basic lead tracking', 'Core team workspace'] },
  { id: BillingPlan.STARTER, name: 'Starter', monthlyPriceInr: 1499, priceLabel: '₹1,499', features: ['Campaign drafts and templates', 'Basic automations', 'Small team collaboration'] },
  { id: BillingPlan.GROWTH, name: 'Growth', monthlyPriceInr: 3499, priceLabel: '₹3,499', features: ['Advanced campaign workflows', 'Team assignment and analytics', 'Growing team controls'] },
  { id: BillingPlan.PRO, name: 'Pro', monthlyPriceInr: 7999, priceLabel: '₹7,999', features: ['Advanced operations and reporting', 'Expanded automation workflows', 'Priority product support'] },
  { id: BillingPlan.AGENCY, name: 'Agency', monthlyPriceInr: 14999, priceLabel: 'From ₹14,999', features: ['Multi-client agency workflow', 'Client reporting foundation', 'Agency team controls'] },
  { id: BillingPlan.ENTERPRISE, name: 'Enterprise', monthlyPriceInr: null, priceLabel: 'Custom', features: ['Custom workspace requirements', 'Enterprise onboarding', 'Commercial terms by agreement'] },
];

@Injectable()
class BillingService {
  constructor(private db: DatabaseService) {}

  async current(workspaceId: string) {
    const subscription = await this.db.workspaceSubscription.findUnique({ where: { workspaceId } });
    if (!subscription) throw new InternalServerErrorException('Workspace billing profile is missing. Apply the latest database migration.');
    const [teamMembers, contacts, campaigns] = await Promise.all([
      this.db.membership.count({ where: { workspaceId } }),
      this.db.contact.count({ where: { workspaceId } }),
      this.db.campaign.count({ where: { workspaceId } }),
    ]);
    return {
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      usage: { teamMembers, contacts, campaigns },
      plans: PLAN_CATALOG,
      paymentsEnabled: false,
    };
  }
}

@Controller('billing')
@UseGuards(AccessGuard, WorkspaceGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
class BillingController {
  constructor(private billing: BillingService) {}
  @Get('current') current(@Req() request: BillingRequest) { return this.billing.current(request.user.workspaceId); }
}

@Module({ imports: [AuthModule, WorkspaceModule], controllers: [BillingController], providers: [BillingService] })
export class BillingModule {}

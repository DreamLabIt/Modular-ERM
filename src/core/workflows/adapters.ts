import type { Prisma } from '@prisma/client';

export type ApprovalOutcome = 'APPROVED' | 'REJECTED';

export interface BusinessApprovalTarget {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  title: string;
  moduleKey: string;
  payload: unknown;
}

/**
 * Applies the final approval outcome to the underlying business record inside
 * the same transaction as the approval action. This is what connects the
 * workflow engine to real business state transitions instead of leaving an
 * approval record detached from the module.
 */
export async function applyApprovalOutcome(
  tx: Prisma.TransactionClient,
  target: BusinessApprovalTarget,
  outcome: ApprovalOutcome,
  actorUserId: string,
  comment: string | null,
): Promise<{ applied: boolean; message: string }> {
  const now = new Date();

  switch (target.resourceType) {
    case 'LEAVE_REQUEST': {
      const updated = await tx.leaveRequest.updateMany({
        where: { id: target.resourceId, organizationId: target.organizationId },
        data: {
          status: outcome,
          approvedById: actorUserId,
          approvedAt: now,
          rejectionReason: outcome === 'REJECTED' ? comment : null,
        },
      });
      return { applied: updated.count === 1, message: `Leave request ${outcome.toLowerCase()}.` };
    }

    case 'PAYROLL_RUN': {
      const run = await tx.payrollRun.findFirst({
        where: { id: target.resourceId, organizationId: target.organizationId },
      });
      if (!run) return { applied: false, message: 'Payroll run not found.' };
      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: outcome,
          approvedById: outcome === 'APPROVED' ? actorUserId : null,
          approvedAt: outcome === 'APPROVED' ? now : null,
          rejectionReason: outcome === 'REJECTED' ? comment : null,
        },
      });
      if (outcome === 'APPROVED') {
        await tx.payroll.updateMany({
          where: { payrollRunId: run.id, organizationId: target.organizationId },
          data: { status: 'APPROVED', approvedAt: now },
        });
      }
      return { applied: true, message: `Payroll run ${outcome.toLowerCase()}.` };
    }

    case 'PURCHASE_ORDER': {
      const updated = await tx.purchaseOrder.updateMany({
        where: { id: target.resourceId, organizationId: target.organizationId },
        data: {
          status: outcome,
          approvedById: outcome === 'APPROVED' ? actorUserId : null,
          approvedAt: outcome === 'APPROVED' ? now : null,
          rejectionReason: outcome === 'REJECTED' ? comment : null,
        },
      });
      if (updated.count === 1) {
        await tx.purchaseOrderApproval.create({
          data: {
            organizationId: target.organizationId,
            purchaseOrderId: target.resourceId,
            action: outcome,
            approvedById: actorUserId,
            rejectedReason: outcome === 'REJECTED' ? comment : null,
          },
        });
      }
      return { applied: updated.count === 1, message: `Purchase order ${outcome.toLowerCase()}.` };
    }

    case 'PROJECT_EXPENSE': {
      const updated = await tx.projectExpense.updateMany({
        where: { id: target.resourceId, organizationId: target.organizationId },
        data: {
          status: outcome,
          approvedById: outcome === 'APPROVED' ? actorUserId : null,
          approvedAt: outcome === 'APPROVED' ? now : null,
        },
      });
      return { applied: updated.count === 1, message: `Project expense ${outcome.toLowerCase()}.` };
    }

    case 'STOCK_ADJUSTMENT': {
      const updated = await tx.stockAdjustment.updateMany({
        where: { id: target.resourceId, organizationId: target.organizationId },
        data: {
          approvedById: outcome === 'APPROVED' ? actorUserId : null,
          approvedAt: outcome === 'APPROVED' ? now : null,
        },
      });
      return { applied: updated.count === 1, message: `Stock adjustment ${outcome.toLowerCase()}.` };
    }

    case 'SALES_INVOICE': {
      if (outcome === 'REJECTED') {
        const updated = await tx.invoice.updateMany({
          where: { id: target.resourceId, organizationId: target.organizationId, status: 'DRAFT' },
          data: { status: 'CANCELLED', cancelledAt: now, cancelledById: actorUserId },
        });
        return { applied: updated.count === 1, message: 'Draft invoice cancelled after rejection.' };
      }
      return { applied: false, message: 'Invoice approval requires an explicit issue action.' };
    }

    default:
      return { applied: false, message: `No business adapter registered for ${target.resourceType}.` };
  }
}

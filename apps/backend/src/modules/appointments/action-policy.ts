import type { AppointmentPublicAction } from '@turnosmart/shared';

export interface CustomerActionPreferences {
  customerConfirmationEnabled: boolean;
  customerCancellationEnabled: boolean;
  customerRescheduleEnabled: boolean;
  cancellationMinimumHours: number;
  rescheduleMinimumHours: number;
}

export function customerActionAllowed(
  action: AppointmentPublicAction,
  business: CustomerActionPreferences,
  startsAt: Date,
  now: Date,
) {
  const remaining = startsAt.getTime() - now.getTime();
  if (remaining <= 0) return false;
  if (action === 'CONFIRM') return business.customerConfirmationEnabled;
  if (action === 'CANCEL')
    return (
      business.customerCancellationEnabled &&
      remaining >= business.cancellationMinimumHours * 3_600_000
    );
  return (
    business.customerRescheduleEnabled && remaining >= business.rescheduleMinimumHours * 3_600_000
  );
}

export const customerActionSelect = {
  customerConfirmationEnabled: true,
  customerCancellationEnabled: true,
  customerRescheduleEnabled: true,
  cancellationMinimumHours: true,
  rescheduleMinimumHours: true,
} as const;

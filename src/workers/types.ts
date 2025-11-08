export type ProcessAlisEventJobData = {
  eventMessageId: string;
  eventType: string;
  companyKey: string;
  companyId: number;
  communityId: number | null;
  notificationData?: Record<string, unknown>;
  eventMessageDate: string;
};

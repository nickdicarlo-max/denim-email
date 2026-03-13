export interface GmailMessageMeta {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  senderEmail: string;
  senderDomain: string;
  senderDisplayName: string;
  recipients: string[];
  date: Date;
  snippet: string;
  isReply: boolean;
  labels: string[];
}

export interface GmailMessageFull extends GmailMessageMeta {
  body: string;
  attachmentIds: string[];
  attachmentCount: number;
}

export interface ScanDiscovery {
  domain: string;
  count: number;
  senders: string[];
  label: string;
}

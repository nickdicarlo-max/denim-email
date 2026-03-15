/**
 * Test email helpers — seeds 7 realistic emails for pipeline testing.
 */
import { prisma } from "@/lib/prisma";

interface EntityIds {
  vmsId: string;
  evscId: string;
  coachId: string;
}

export async function seedTestEmails(
  schemaId: string,
  entityIds: EntityIds,
): Promise<void> {
  const { vmsId, evscId, coachId } = entityIds;
  const now = new Date();

  // Dates spread across the last 2 weeks
  const d = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  await prisma.email.createMany({
    data: [
      // --- VMS Permission thread (3 emails) ---
      {
        schemaId,
        entityId: vmsId,
        gmailMessageId: "msg_vms_perm_1",
        threadId: "thread_vms_perm",
        subject: "Permission Slip: Denver Zoo Field Trip",
        sender: "Office <office@vms.edu>",
        senderEmail: "office@vms.edu",
        senderDomain: "vms.edu",
        senderDisplayName: "Office",
        date: d(12),
        isReply: false,
        threadPosition: 1,
        summary:
          "Permission slip for Denver Zoo field trip on March 28. Return signed form by March 21. Cost is $15 per student.",
        tags: ["Permission/Form", "Action Required"],
        extractedData: { eventDate: d(2).toISOString() },
        bodyLength: 450,
      },
      {
        schemaId,
        entityId: vmsId,
        gmailMessageId: "msg_vms_perm_2",
        threadId: "thread_vms_perm",
        subject: "REMINDER: Permission Slip Due Friday",
        sender: "Office <office@vms.edu>",
        senderEmail: "office@vms.edu",
        senderDomain: "vms.edu",
        senderDisplayName: "Office",
        date: d(7),
        isReply: false,
        threadPosition: 2,
        summary:
          "Reminder that Denver Zoo permission slips are due this Friday. Please sign and return.",
        tags: ["Permission/Form", "Action Required"],
        extractedData: {},
        bodyLength: 200,
      },
      {
        schemaId,
        entityId: vmsId,
        gmailMessageId: "msg_vms_perm_3",
        threadId: "thread_vms_perm",
        subject: "RE: Permission Slip: Denver Zoo Field Trip",
        sender: "Ms. Johnson <johnson@vms.edu>",
        senderEmail: "johnson@vms.edu",
        senderDomain: "vms.edu",
        senderDisplayName: "Ms. Johnson",
        date: d(5),
        isReply: true,
        threadPosition: 3,
        summary:
          "Ms. Johnson confirms chaperone spots are filled. Bus departs at 8:15am. Students should bring a sack lunch.",
        tags: ["Permission/Form", "Schedule"],
        extractedData: {},
        bodyLength: 320,
      },

      // --- EVSC Schedule thread (2 emails) ---
      {
        schemaId,
        entityId: evscId,
        senderEntityId: coachId,
        gmailMessageId: "msg_evsc_sched_1",
        threadId: "thread_evsc_sched",
        subject: "Updated Practice Schedule - Spring Season",
        sender: "Coach Martinez <martinez@evsc.org>",
        senderEmail: "martinez@evsc.org",
        senderDomain: "evsc.org",
        senderDisplayName: "Coach Martinez",
        date: d(10),
        isReply: false,
        threadPosition: 1,
        summary:
          "Spring practice schedule: Tuesday and Thursday 4:30-6pm at Field 3. First practice March 18.",
        tags: ["Schedule", "Practice"],
        extractedData: { eventDate: d(4).toISOString() },
        bodyLength: 380,
      },
      {
        schemaId,
        entityId: evscId,
        senderEntityId: coachId,
        gmailMessageId: "msg_evsc_sched_2",
        threadId: "thread_evsc_sched",
        subject: "RE: Updated Practice Schedule - Spring Season",
        sender: "Coach Martinez <martinez@evsc.org>",
        senderEmail: "martinez@evsc.org",
        senderDomain: "evsc.org",
        senderDisplayName: "Coach Martinez",
        date: d(8),
        isReply: true,
        threadPosition: 2,
        summary:
          "Thursday practice moved to Field 5 due to maintenance. Same time 4:30-6pm.",
        tags: ["Schedule", "Practice"],
        extractedData: {},
        bodyLength: 150,
      },

      // --- VMS Payment thread (1 email, same entity different topic) ---
      {
        schemaId,
        entityId: vmsId,
        gmailMessageId: "msg_vms_payment_1",
        threadId: "thread_vms_payment",
        subject: "Spring Activity Fee - $125 Due March 20",
        sender: "Billing <billing@vms.edu>",
        senderEmail: "billing@vms.edu",
        senderDomain: "vms.edu",
        senderDisplayName: "Billing",
        date: d(9),
        isReply: false,
        threadPosition: 1,
        summary:
          "Spring activity fee of $125 per student is due March 20. Pay online or send check to school office.",
        tags: ["Payment"],
        extractedData: {},
        bodyLength: 280,
      },

      // --- Noise email (excluded) ---
      {
        schemaId,
        entityId: null,
        gmailMessageId: "msg_noise_1",
        threadId: "thread_noise",
        subject: "Weekly Digest - School Newsletter",
        sender: "Newsletter <noreply@schoolnews.com>",
        senderEmail: "noreply@schoolnews.com",
        senderDomain: "schoolnews.com",
        senderDisplayName: "Newsletter",
        date: d(6),
        isReply: false,
        threadPosition: 1,
        summary: "Weekly digest of school news and community events.",
        tags: [],
        extractedData: {},
        isExcluded: true,
        excludeReason: "rule:domain",
        bodyLength: 1200,
      },
    ],
  });
}

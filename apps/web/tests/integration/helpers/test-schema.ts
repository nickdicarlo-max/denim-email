/**
 * Test schema helpers — creates a full school_parent CaseSchema with entities,
 * tags, and extracted field definitions.
 */
import { prisma } from "@/lib/prisma";

export interface TestSchemaResult {
  schema: { id: string };
  entities: {
    vms: { id: string; name: string };
    evsc: { id: string; name: string };
    coach: { id: string; name: string };
  };
  tags: Array<{ id: string; name: string }>;
  fields: Array<{ id: string; name: string }>;
}

export async function createTestSchema(userId: string): Promise<TestSchemaResult> {
  // 1. Create the CaseSchema
  const schema = await prisma.caseSchema.create({
    data: {
      userId,
      name: "School & Sports Communications",
      description:
        "Emails from my kids' schools (Valley Montessori and East Valley Sports Complex) plus their sports activities.",
      domain: "school_parent",
      status: "ACTIVE",
      primaryEntityConfig: {
        name: "School/Organization",
        description: "School or sports organization that sends communications",
        autoDetect: true,
        internalDomains: [],
      },
      secondaryEntityConfig: [
        {
          name: "Coach/Teacher",
          description: "Individual staff member (coach, teacher, admin)",
          derivedFrom: "sender",
          affinityScore: 30,
        },
      ],
      discoveryQueries: [
        { query: "from:vms.edu OR from:evsc.org", label: "School emails" },
      ],
      summaryLabels: {
        beginning: "Issue",
        middle: "Activity",
        end: "Status",
      },
      extractionPrompt:
        "Extract key information from school/sports parent emails: event dates, deadlines, fees, permission requirements, schedule changes.",
      synthesisPrompt:
        "Synthesize school/sports parent email threads into cases. Group by topic within each school/organization. Identify action items parents need to complete.",
      clusteringConfig: {
        mergeThreshold: 45,
        tagMatchScore: 60,
        subjectMatchScore: 50,
        weakTagDiscount: 0.3,
        anchorTagLimit: 2,
        timeDecayDays: { fresh: 45, recent: 75, stale: 120 },
        caseSizeThreshold: 10,
        caseSizeMaxBonus: 25,
        subjectAdditiveBonus: 25,
        stopWords: [],
        autoFrequencyDiscount: true,
        frequencyThreshold: 0.3,
      },
    },
  });

  // 2. Create PRIMARY entities
  const vms = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "Valley Montessori School",
      type: "PRIMARY",
      aliases: ["VMS", "Valley Montessori"],
      autoDetected: false,
      confidence: 1.0,
    },
  });

  const evsc = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "East Valley Sports Complex",
      type: "PRIMARY",
      aliases: ["EVSC", "East Valley Sports"],
      autoDetected: false,
      confidence: 1.0,
    },
  });

  // 3. Create SECONDARY entity
  const coach = await prisma.entity.create({
    data: {
      schemaId: schema.id,
      name: "Coach Martinez",
      type: "SECONDARY",
      secondaryTypeName: "Coach/Teacher",
      aliases: ["Martinez", "Coach M"],
      autoDetected: false,
      confidence: 1.0,
      associatedPrimaryIds: [evsc.id],
    },
  });

  // 4. Create SchemaTag rows
  const tagNames = [
    { name: "Action Required", description: "Parent needs to take action" },
    { name: "Schedule", description: "Schedule or calendar related" },
    { name: "Payment", description: "Fees, costs, or payment due" },
    { name: "Permission/Form", description: "Permission slip or form needed" },
    { name: "Game/Match", description: "Game day or match information" },
    { name: "Practice", description: "Practice schedule or update" },
  ];

  const tags = await Promise.all(
    tagNames.map((t) =>
      prisma.schemaTag.create({
        data: {
          schemaId: schema.id,
          name: t.name,
          description: t.description,
          aiGenerated: true,
          isActive: true,
        },
      }),
    ),
  );

  // 5. Create ExtractedFieldDef
  const eventDateField = await prisma.extractedFieldDef.create({
    data: {
      schemaId: schema.id,
      name: "eventDate",
      type: "DATE",
      description: "Date of the event, deadline, or due date mentioned in email",
      aggregation: "LATEST",
      showOnCard: true,
    },
  });

  return {
    schema: { id: schema.id },
    entities: {
      vms: { id: vms.id, name: vms.name },
      evsc: { id: evsc.id, name: evsc.name },
      coach: { id: coach.id, name: coach.name },
    },
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    fields: [{ id: eventDateField.id, name: eventDateField.name }],
  };
}

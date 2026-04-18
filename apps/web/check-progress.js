const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

// Load .env.local manually
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed
    .slice(eqIdx + 1)
    .trim()
    .replace(/^"|"$/g, "");
  process.env[key] = val;
}

const p = new PrismaClient();

async function main() {
  const j = await p.scanJob.findFirst({ orderBy: { createdAt: "desc" } });
  console.log("ScanJob:", {
    total: j?.totalEmails,
    processed: j?.processedEmails,
    excluded: j?.excludedEmails,
    failed: j?.failedEmails,
    phase: j?.phase,
    status: j?.status,
  });

  const s = await p.caseSchema.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, discoveryQueries: true, emailCount: true },
  });
  const q = s?.discoveryQueries;
  console.log("Schema:", s?.id, "emailCount:", s?.emailCount);
  if (Array.isArray(q)) {
    console.log("Discovery queries (" + q.length + "):");
    q.forEach((x) => console.log("  -", x.query));
  }

  const emailCount = await p.email.count({ where: { schemaId: s?.id } });
  console.log("Email rows in DB:", emailCount);

  const costRows = await p.extractionCost.count();
  console.log("ExtractionCost rows:", costRows);

  // Check users with tokens
  const users = await p.user.findMany({ select: { id: true, email: true, googleTokens: true } });
  console.log(
    "Users:",
    users.map((u) => ({ id: u.id, email: u.email, hasTokens: !!u.googleTokens })),
  );

  // Check the scanJob's userId matches
  if (j) {
    console.log("ScanJob userId:", j.userId);
    const user = await p.user.findUnique({
      where: { id: j.userId },
      select: { id: true, googleTokens: true },
    });
    console.log("User has tokens:", !!user?.googleTokens);
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

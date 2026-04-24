import { describe, expect, it } from "vitest";
import type { ConfirmedEntity } from "@/lib/services/interview";
import { simulateReviewGate } from "../eval-gate-sim";

function entity(
  displayLabel: string,
  origin: ConfirmedEntity["origin"],
  discoveryScore?: number,
  kind: "PRIMARY" | "SECONDARY" = "PRIMARY",
): ConfirmedEntity {
  return {
    displayLabel,
    identityKey: displayLabel.toLowerCase().replace(/\s+/g, "-"),
    kind,
    origin,
    discoveryScore,
  };
}

describe("simulateReviewGate", () => {
  it("always accepts deterministic origins", () => {
    const r = simulateReviewGate({
      entities: [
        entity("851 Peavy Road", "USER_HINT"),
        entity("Timothy Bishop", "USER_SEEDED", undefined, "SECONDARY"),
        entity("soccer", "STAGE2_SHORT_CIRCUIT"),
        entity("Portfolio Pro Advisors", "STAGE2_AGENCY_DOMAIN"),
        entity("Stage1 domain", "STAGE1_TRIANGULATED"),
        entity("Feedback rule", "FEEDBACK_RULE"),
      ],
      userWhats: [],
    });
    expect(r.accepted).toHaveLength(6);
    expect(r.rejected).toEqual([]);
  });

  it("accepts Gemini candidates with score >= 1", () => {
    const r = simulateReviewGate({
      entities: [
        entity("205 Freedom Trail", "STAGE2_GEMINI", 1),
        entity("3305 Cardinal", "STAGE2_GEMINI", 0),
      ],
      userWhats: ["851 Peavy", "3910 Bucknell"],
    });
    expect(r.accepted.map((e) => e.displayLabel)).toEqual(["205 Freedom Trail"]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toBe("stage2_gemini_score_0_no_hint_overlap");
  });

  it("accepts Gemini candidates with hint-token overlap even at score 0", () => {
    const r = simulateReviewGate({
      entities: [entity("851 Peavy Road", "STAGE2_GEMINI", 0)],
      userWhats: ["851 Peavy"],
    });
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it("rejects Gemini score=0 candidates with no hint overlap", () => {
    const r = simulateReviewGate({
      entities: [entity("Some Random Thing", "STAGE2_GEMINI", 0)],
      userWhats: ["soccer", "dance"],
    });
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejectedByReason.stage2_gemini_score_0_no_hint_overlap).toBe(1);
  });

  it("MID_SCAN requires hint overlap", () => {
    const r = simulateReviewGate({
      entities: [entity("Drift Topic", "MID_SCAN"), entity("soccer variant", "MID_SCAN")],
      userWhats: ["soccer"],
    });
    expect(r.accepted.map((e) => e.displayLabel)).toEqual(["soccer variant"]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toBe("mid_scan_without_hint_overlap");
  });

  it("verdict map covers every entity", () => {
    const r = simulateReviewGate({
      entities: [entity("Accepted", "USER_HINT"), entity("Rejected", "STAGE2_GEMINI", 0)],
      userWhats: ["different hint"],
    });
    expect(r.verdicts.get("accepted")).toBe("accepted");
    expect(r.verdicts.get("rejected")).toBe("rejected");
  });

  it("unknown origin rejects with 'unknown_origin' reason", () => {
    const r = simulateReviewGate({
      entities: [entity("Orphan", undefined)],
      userWhats: [],
    });
    expect(r.rejected[0].reason).toBe("unknown_origin");
  });
});

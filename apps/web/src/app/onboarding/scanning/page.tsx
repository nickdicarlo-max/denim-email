"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OnboardingProgress } from "@/components/onboarding/progress";
import { ScanStream } from "@/components/onboarding/scan-stream";
import { onboardingStorage } from "@/lib/onboarding-storage";

export default function ScanningPage() {
  const router = useRouter();
  const [schemaId, setSchemaId] = useState<string | null>(null);

  useEffect(() => {
    const id = onboardingStorage.getSchemaId();
    if (!id) {
      router.replace("/onboarding/category");
      return;
    }
    setSchemaId(id);
  }, [router]);

  const onComplete = useCallback(() => {
    router.push("/onboarding/review");
  }, [router]);

  if (!schemaId) return null;

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <OnboardingProgress currentStep={3} totalSteps={5} />

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 max-w-md mx-auto w-full">
        <h1 className="font-serif text-2xl text-primary text-center mb-8">Scanning your inbox</h1>

        <ScanStream schemaId={schemaId} onComplete={onComplete} />
      </div>
    </div>
  );
}

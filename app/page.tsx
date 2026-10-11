import Troubleshoot from "@/components/Troubleshoot";
import { PageHeader } from "@/components/ui";

// Troubleshoot is the home page.
export default function TroubleshootPage() {
  return (
    <>
      <PageHeader
        title="Troubleshoot"
        subtitle="Get a diagnosis and next steps from the plant manual, checked by fixed safety rules."
      />
      <Troubleshoot />
    </>
  );
}

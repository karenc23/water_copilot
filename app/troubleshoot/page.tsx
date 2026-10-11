import TroubleshootViews from "@/components/TroubleshootViews";
import { PageHeader } from "@/components/ui";

export default function TroubleshootPage() {
  return (
    <>
      <PageHeader
        title="Troubleshoot"
        subtitle="Get a diagnosis and next steps from the plant manual, checked by fixed safety rules."
      />
      <TroubleshootViews />
    </>
  );
}

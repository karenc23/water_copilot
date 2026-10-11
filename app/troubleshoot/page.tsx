import TroubleshootViews from "@/components/TroubleshootViews";
import { PageHeader } from "@/components/ui";

export default function TroubleshootPage() {
  return (
    <>
      <PageHeader
        title="Troubleshoot"
        subtitle="Describe the problem, and watch the agents work it out."
      />
      <TroubleshootViews />
    </>
  );
}

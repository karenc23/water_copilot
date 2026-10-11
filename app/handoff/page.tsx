import Handoff from "@/components/Handoff";
import AgentBadge from "@/components/agents/AgentBadge";
import { PageHeader } from "@/components/ui";

export default function HandoffPage() {
  return (
    <>
      <PageHeader
        title="Handoff Guide"
        subtitle="The Keeper writes down what a new operator needs to know."
        agent={<AgentBadge id="keeper" />}
      />
      <Handoff />
    </>
  );
}

import Handoff from "@/components/Handoff";
import AgentBadge from "@/components/agents/AgentBadge";
import { PageHeader } from "@/components/ui";

export default function HandoffPage() {
  return (
    <>
      <PageHeader
        title="The Keeper writes the handbook"
        subtitle="Everything a new operator needs to know about Plant A."
        agent={<AgentBadge id="keeper" />}
      />
      <Handoff />
    </>
  );
}

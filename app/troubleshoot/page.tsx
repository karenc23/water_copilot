import { redirect } from "next/navigation";

// Troubleshoot lives at "/" (the default page).
export default function TroubleshootRedirect() {
  redirect("/");
}

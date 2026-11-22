import { redirect } from "next/navigation";
import { getVaultSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getVaultSession();
  if (!session) redirect("/login");
  return <AppShell key={session.userId} user={{ id: session.userId, email: session.email, displayName: session.displayName }}>{children}</AppShell>;
}

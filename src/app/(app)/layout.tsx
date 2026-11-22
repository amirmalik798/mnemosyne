import { redirect } from "next/navigation";
import { getVaultSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!(await getVaultSession())) redirect("/unlock");
  return <AppShell>{children}</AppShell>;
}

import { redirect } from "next/navigation";
import { getVaultSession, isVaultInitialized } from "@/lib/auth";
import { VaultUnlock } from "@/components/vault-forms";

export const dynamic = "force-dynamic";
export default async function UnlockPage() {
  if (!(await isVaultInitialized())) redirect("/setup");
  if (await getVaultSession()) redirect("/library");
  return <VaultUnlock />;
}

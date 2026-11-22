import { redirect } from "next/navigation";
import { isVaultInitialized } from "@/lib/auth";
import { VaultSetup } from "@/components/vault-forms";

export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (await isVaultInitialized()) redirect("/unlock");
  return <VaultSetup />;
}

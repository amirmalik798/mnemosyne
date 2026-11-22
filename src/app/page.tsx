import { redirect } from "next/navigation";
import { getVaultSession, isVaultInitialized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isVaultInitialized())) redirect("/setup");
  if (!(await getVaultSession())) redirect("/unlock");
  redirect("/library");
}

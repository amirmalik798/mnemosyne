import { redirect } from "next/navigation";
import { getVaultSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await getVaultSession())) redirect("/login");
  redirect("/library");
}

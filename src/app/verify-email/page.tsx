import { VerifyEmailForm } from "@/components/account-forms";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <VerifyEmailForm token={token} />;
}

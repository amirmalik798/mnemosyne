"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function ProtectedAreaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState reset={reset} errorReference={error.digest} showLibraryLink />;
}

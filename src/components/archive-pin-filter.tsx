"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";

export type ArchivePinFilterValue = "all" | "pinned" | "unpinned";

const OPTIONS: Array<{ value: ArchivePinFilterValue; label: string }> = [
  { value: "all", label: "All notes" },
  { value: "pinned", label: "Pinned only" },
  { value: "unpinned", label: "Unpinned only" },
];

export function ArchivePinFilter({
  basePath,
  currentFilter,
  preserveQuery = "",
}: {
  basePath: string;
  currentFilter: ArchivePinFilterValue;
  preserveQuery?: string;
}) {
  const router = useRouter();
  const id = useId();

  function changeFilter(nextFilter: ArchivePinFilterValue) {
    const params = new URLSearchParams(preserveQuery);
    params.delete("page");
    if (nextFilter === "all") params.delete("pin");
    else params.set("pin", nextFilter);
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="archive-pin-filter">
      <label htmlFor={id}>Show</label>
      <select
        id={id}
        className="select-field"
        value={currentFilter}
        onChange={(event) => changeFilter(event.target.value as ArchivePinFilterValue)}
        aria-label="Filter notes by pinned status"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

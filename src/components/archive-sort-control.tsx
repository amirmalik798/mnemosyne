"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import type { ArchiveSort } from "@/lib/archive-sort";

const OPTIONS: Array<{ value: ArchiveSort; label: string }> = [
  { value: "created-desc", label: "Recently created" },
  { value: "modified-desc", label: "Recently modified" },
  { value: "title-asc", label: "Title: A–Z" },
  { value: "title-desc", label: "Title: Z–A" },
];

export function ArchiveSortControl({
  basePath,
  currentSort,
  preserveQuery = "",
}: {
  basePath: string;
  currentSort: ArchiveSort;
  preserveQuery?: string;
}) {
  const router = useRouter();
  const id = useId();

  function changeSort(nextSort: ArchiveSort) {
    const params = new URLSearchParams(preserveQuery);
    params.set("sort", nextSort);
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="archive-sort-control">
      <label htmlFor={id}>Sort by</label>
      <select
        id={id}
        className="select-field"
        value={currentSort}
        onChange={(event) => changeSort(event.target.value as ArchiveSort)}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

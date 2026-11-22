"use client";

import { useRouter } from "next/navigation";
import { Layers3, X } from "lucide-react";
import { EmptyState, TopicCard, type TopicItem } from "@/components/archive-ui";

const UNCATEGORIZED = "__uncategorized__";

export function TopicArchive({
  topics,
  categories,
  categoryCounts,
  uncategorizedCount,
  totalTopics,
  allTopicsCount,
  selectedCategory,
}: {
  topics: TopicItem[];
  categories: string[];
  categoryCounts: Record<string, number>;
  uncategorizedCount: number;
  totalTopics: number;
  allTopicsCount: number;
  selectedCategory: string;
}) {
  const router = useRouter();

  function chooseCategory(value: string) {
    const nextValue = selectedCategory.toLocaleLowerCase() === value.toLocaleLowerCase()
      ? ""
      : value;
    router.push(
      nextValue
        ? `/topics?category=${encodeURIComponent(nextValue)}`
        : "/topics",
    );
  }

  return (
    <section className="topic-browser" aria-label="Browse topics by category">
      <div className="topic-browser-heading">
        <div>
          <div className="eyebrow">Browse by category</div>
          <p className="topic-browser-caption">
            Choose a category to see every topic filed under it.
          </p>
        </div>
        <div className="topic-browser-count" aria-live="polite">
          <strong>{totalTopics}</strong>
          <span>{totalTopics === 1 ? "topic" : "topics"}</span>
          {selectedCategory && <span>of {allTopicsCount}</span>}
        </div>
      </div>

      <div className="topic-filter-chips" role="group" aria-label="Topic category filter">
        <button
          type="button"
          className={selectedCategory === "" ? "topic-filter-chip active" : "topic-filter-chip"}
          onClick={() => chooseCategory("")}
          aria-pressed={selectedCategory === ""}
        >
          <Layers3 size={14} />
          All categories
          <span>{allTopicsCount}</span>
        </button>

        {categories.map((category) => {
          const active = selectedCategory.toLocaleLowerCase() === category.toLocaleLowerCase();
          const count = categoryCounts[category.toLocaleLowerCase()] ?? 0;
          return (
            <button
              type="button"
              key={category.toLocaleLowerCase()}
              className={active ? "topic-filter-chip active" : "topic-filter-chip"}
              onClick={() => chooseCategory(category)}
              aria-pressed={active}
            >
              {category}
              <span>{count}</span>
            </button>
          );
        })}

        {uncategorizedCount > 0 && (
          <button
            type="button"
            className={selectedCategory === UNCATEGORIZED ? "topic-filter-chip active" : "topic-filter-chip"}
            onClick={() => chooseCategory(UNCATEGORIZED)}
            aria-pressed={selectedCategory === UNCATEGORIZED}
          >
            Uncategorized
            <span>{uncategorizedCount}</span>
          </button>
        )}
      </div>

      {topics.length > 0 ? (
        <div className="topic-grid">
          {topics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}
        </div>
      ) : (
        <div className="topic-filter-empty">
          <EmptyState
            title={selectedCategory ? "No topics in this category" : "No topics created"}
            copy={selectedCategory
              ? "Choose another category or return to the full collection."
              : "Create a collection for a subject, project, book or idea you want to develop."}
            action={selectedCategory ? (
              <button type="button" className="secondary-btn" onClick={() => chooseCategory("")}>
                <X size={14} /> Clear category filter
              </button>
            ) : null}
          />
        </div>
      )}
    </section>
  );
}

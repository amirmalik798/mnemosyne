"use client";

import { useMemo, useState } from "react";
import { Layers3, X } from "lucide-react";
import { EmptyState, TopicCard, type TopicItem } from "@/components/archive-ui";

const UNCATEGORIZED = "__uncategorized__";
const TOPIC_PAGE_SIZE = 24;

export function TopicArchive({
  topics,
  categories,
}: {
  topics: TopicItem[];
  categories: string[];
}) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const topic of topics) {
      const category = topic.category.trim();
      if (!category) continue;
      const key = category.toLocaleLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [topics]);

  const uncategorizedCount = useMemo(
    () => topics.filter((topic) => !topic.category.trim()).length,
    [topics],
  );

  const filteredTopics = useMemo(() => {
    if (!selectedCategory) return topics;
    if (selectedCategory === UNCATEGORIZED) {
      return topics.filter((topic) => !topic.category.trim());
    }
    const selected = selectedCategory.toLocaleLowerCase();
    return topics.filter(
      (topic) => topic.category.trim().toLocaleLowerCase() === selected,
    );
  }, [topics, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredTopics.length / TOPIC_PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const visibleTopics = useMemo(
    () => filteredTopics.slice((page - 1) * TOPIC_PAGE_SIZE, page * TOPIC_PAGE_SIZE),
    [filteredTopics, page],
  );

  function chooseCategory(value: string) {
    setSelectedCategory(value);
    setCurrentPage(1);
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
          <strong>{filteredTopics.length}</strong>
          <span>{filteredTopics.length === 1 ? "topic" : "topics"}</span>
          {selectedCategory && <span>of {topics.length}</span>}
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
          <span>{topics.length}</span>
        </button>

        {categories.map((category) => {
          const count = categoryCounts.get(category.toLocaleLowerCase()) ?? 0;
          const active = selectedCategory.toLocaleLowerCase() === category.toLocaleLowerCase();
          return (
            <button
              type="button"
              key={category.toLocaleLowerCase()}
              className={active ? "topic-filter-chip active" : "topic-filter-chip"}
              onClick={() => chooseCategory(active ? "" : category)}
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
            onClick={() => chooseCategory(selectedCategory === UNCATEGORIZED ? "" : UNCATEGORIZED)}
            aria-pressed={selectedCategory === UNCATEGORIZED}
          >
            Uncategorized
            <span>{uncategorizedCount}</span>
          </button>
        )}
      </div>

      {visibleTopics.length > 0 ? (
        <>
          <div className="topic-grid">
            {visibleTopics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}
          </div>
          {totalPages > 1 && (
            <nav className="archive-pagination" aria-label="Topic pages">
              <span className="archive-pagination-summary">
                Showing {(page - 1) * TOPIC_PAGE_SIZE + 1}–{Math.min(page * TOPIC_PAGE_SIZE, filteredTopics.length)} of {filteredTopics.length}
              </span>
              <div className="archive-pagination-controls">
                <button type="button" className="secondary-btn" onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Previous</button>
                <span className="archive-pagination-page">Page {page} of {totalPages}</span>
                <button type="button" className="secondary-btn" onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>Next</button>
              </div>
            </nav>
          )}
        </>
      ) : (
        <div className="topic-filter-empty">
          <EmptyState
            title="No topics in this category"
            copy="Choose another category or return to the full collection."
            action={
              <button type="button" className="secondary-btn" onClick={() => chooseCategory("")}>
                <X size={14} /> Clear category filter
              </button>
            }
          />
        </div>
      )}
    </section>
  );
}

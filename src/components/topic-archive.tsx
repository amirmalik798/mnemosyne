"use client";

import { useState } from "react";
import { Layers3 } from "lucide-react";
import { EmptyState, TopicCard, type TopicItem } from "@/components/archive-ui";

export function TopicArchive({
  topics,
  categories,
  totalTopics,
}: {
  topics: TopicItem[];
  categories: string[];
  totalTopics: number;
}) {
  const selectedCategory = "";

  const visibleTopics = topics;

  return (
    <section className="topic-browser" aria-label="Browse topics by category">
      <div className="topic-browser-heading">
        <div>
          <div className="eyebrow">Browse by category</div>
          <p className="topic-browser-caption">
            Browse the archive by category. Use the archive pages below to explore every topic.
          </p>
        </div>
        <div className="topic-browser-count" aria-live="polite">
          <strong>{totalTopics}</strong>
          <span>{totalTopics === 1 ? "topic" : "topics"}</span>
        </div>
      </div>

      <div className="topic-filter-chips" role="group" aria-label="Topic category filter">
        <button
          type="button"
          className="topic-filter-chip active"
          aria-pressed={true}
        >
          <Layers3 size={14} />
          All categories
        </button>

        {categories.map((category) => (
          <span className="topic-filter-chip" key={category.toLocaleLowerCase()}>
            {category}
          </span>
        ))}
      </div>

      {visibleTopics.length > 0 ? (
        <div className="topic-grid">
          {visibleTopics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}
        </div>
      ) : (
        <div className="topic-filter-empty">
          <EmptyState
            title="No topics on this page"
            copy="Continue to another archive page or create your first topic."
            action={null}
          />
        </div>
      )}
    </section>
  );
}

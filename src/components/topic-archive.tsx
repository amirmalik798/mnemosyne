"use client";

import { useRouter } from "next/navigation";
import { BookOpen, Brain, Briefcase, Cpu, FlaskConical, Folder, Globe, GraduationCap, Layers3, Palette, Tag, X } from "lucide-react";
import { EmptyState, TopicCard, type TopicItem } from "@/components/archive-ui";

const UNCATEGORIZED = "__uncategorized__";

function CategoryIcon({ category }: { category: string }) {
  const value = category.trim().toLocaleLowerCase();
  if (/read|book|literature|writing/.test(value)) return <BookOpen size={16} aria-hidden="true" />;
  if (/science|research|biology|chemistry|physics/.test(value)) return <FlaskConical size={16} aria-hidden="true" />;
  if (/tech|software|computer|program|ai|code/.test(value)) return <Cpu size={16} aria-hidden="true" />;
  if (/work|business|career|project/.test(value)) return <Briefcase size={16} aria-hidden="true" />;
  if (/school|study|learn|education|course/.test(value)) return <GraduationCap size={16} aria-hidden="true" />;
  if (/philosophy|psychology|mind|thought/.test(value)) return <Brain size={16} aria-hidden="true" />;
  if (/art|design|photo|music|creative/.test(value)) return <Palette size={16} aria-hidden="true" />;
  if (/travel|world|language|culture|history/.test(value)) return <Globe size={16} aria-hidden="true" />;
  return <Tag size={16} aria-hidden="true" />;
}

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
          aria-label={`Show all categories (${allTopicsCount} topics)`}
          title={`All categories · ${allTopicsCount} topics`}
        >
          <Layers3 size={16} />
        </button>

        {categories.map((category) => {
          const active = selectedCategory.toLocaleLowerCase() === category.toLocaleLowerCase();
          const count = categoryCounts[category.toLocaleLowerCase()] ?? 0;
          return (
            <button
              type="button"
              key={category.toLocaleLowerCase()}
              className={active ? "topic-filter-chip icon-only-btn active" : "topic-filter-chip icon-only-btn"}
              onClick={() => chooseCategory(category)}
              aria-pressed={active}
              aria-label={`Show ${category} topics (${count})`}
              title={`${category} · ${count} topics`}
            >
              <CategoryIcon category={category} />
            </button>
          );
        })}

        {uncategorizedCount > 0 && (
          <button
            type="button"
            className={selectedCategory === UNCATEGORIZED ? "topic-filter-chip icon-only-btn active" : "topic-filter-chip icon-only-btn"}
            onClick={() => chooseCategory(UNCATEGORIZED)}
            aria-pressed={selectedCategory === UNCATEGORIZED}
            aria-label={`Show uncategorized topics (${uncategorizedCount})`}
            title={`Uncategorized · ${uncategorizedCount} topics`}
          >
            <Folder size={16} aria-hidden="true" />
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
              <button type="button" className="secondary-btn icon-only-btn" onClick={() => chooseCategory("")} aria-label="Clear category filter" title="Clear category filter">
                <X size={17} />
              </button>
            ) : null}
          />
        </div>
      )}
    </section>
  );
}

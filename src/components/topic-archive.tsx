"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, Brain, Briefcase, Cpu, FlaskConical, Folder, Globe, GraduationCap, Layers3, Palette, Tag, X } from "lucide-react";
import { EmptyState, TopicCard, type TopicItem } from "@/components/archive-ui";
import { ArchiveSortControl } from "@/components/archive-sort-control";
import { DEFAULT_ARCHIVE_SORT, type ArchiveSort } from "@/lib/archive-sort";
import { OpenTopicDialogButton } from "@/components/open-topic-dialog-button";

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
  sort,
  unavailableOnPage,
}: {
  topics: TopicItem[];
  categories: string[];
  categoryCounts: Record<string, number>;
  uncategorizedCount: number;
  totalTopics: number;
  allTopicsCount: number;
  selectedCategory: string;
  sort: ArchiveSort;
  unavailableOnPage: number;
}) {
  const router = useRouter();
  const selectedCategoryLabel = selectedCategory === UNCATEGORIZED ? "Uncategorized" : selectedCategory;
  const gridLayout = topics.length === 1 ? "single" : topics.length === 2 ? "pair" : "many";

  function chooseCategory(value: string) {
    const nextValue = selectedCategory.toLocaleLowerCase() === value.toLocaleLowerCase()
      ? ""
      : value;
    const params = new URLSearchParams();
    if (nextValue) params.set("category", nextValue);
    if (sort !== DEFAULT_ARCHIVE_SORT) params.set("sort", sort);
    const query = params.toString();
    router.push(query ? `/topics?${query}` : "/topics");
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
        {selectedCategory && (
          <div className="topic-browser-count" aria-live="polite">
            <strong>{totalTopics}</strong>
            <span>{totalTopics === 1 ? "collection" : "collections"}</span>
            <span>of {allTopicsCount}</span>
          </div>
        )}
        <ArchiveSortControl
          basePath="/topics"
          currentSort={sort}
          preserveQuery={selectedCategory ? `category=${encodeURIComponent(selectedCategory)}` : ""}
        />
      </div>

      <div className="topic-filter-chips" role="group" aria-label="Topic category filter">
        <button
          type="button"
          className={selectedCategory === "" ? "topic-filter-chip active" : "topic-filter-chip"}
          onClick={() => chooseCategory("")}
          aria-pressed={selectedCategory === ""}
          aria-label={`Show all topics (${allTopicsCount})`}
          title={`All topics · ${allTopicsCount}`}
        >
          <Layers3 size={16} aria-hidden="true" />
          <strong>All topics</strong>
          <span aria-hidden="true">{allTopicsCount}</span>
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
              aria-label={`Show ${category} topics (${count})`}
              title={`${category} · ${count} topics`}
            >
              <CategoryIcon category={category} />
              <strong>{category}</strong>
              <span aria-hidden="true">{count}</span>
            </button>
          );
        })}

        {uncategorizedCount > 0 && (
          <button
            type="button"
            className={selectedCategory === UNCATEGORIZED ? "topic-filter-chip active" : "topic-filter-chip"}
            onClick={() => chooseCategory(UNCATEGORIZED)}
            aria-pressed={selectedCategory === UNCATEGORIZED}
            aria-label={`Show uncategorized topics (${uncategorizedCount})`}
            title={`Uncategorized · ${uncategorizedCount} topics`}
          >
            <Folder size={16} aria-hidden="true" />
            <strong>Uncategorized</strong>
            <span aria-hidden="true">{uncategorizedCount}</span>
          </button>
        )}
      </div>

      {selectedCategory && (
        <div className="topic-filter-status" role="status" aria-live="polite">
          <div className="topic-filter-status-copy">
            <span className="topic-filter-status-dot" aria-hidden="true" />
            <span>Showing <strong>{selectedCategoryLabel}</strong> topics</span>
            <span className="topic-filter-status-count">{totalTopics} of {allTopicsCount}</span>
          </div>
          <button type="button" className="topic-filter-clear" onClick={() => chooseCategory("")}>
            <X size={14} aria-hidden="true" /><span>Clear filter</span>
          </button>
        </div>
      )}

      {topics.length > 0 ? (
        <div className={`topic-grid topic-archive-grid topic-archive-grid--${gridLayout}`} data-layout={gridLayout} aria-label={`Showing ${topics.length} collections`}>
          {topics.map((topic) => <TopicCard key={topic.id} topic={topic} variant={gridLayout === "single" ? "archive-featured" : "archive"} />)}
        </div>
      ) : (
        <div className="topic-filter-empty">
          {unavailableOnPage > 0 ? (
            <EmptyState
              title="Some collections are unavailable"
              copy="The encrypted details for these collections could not be verified, so they have not been displayed. No records were changed or deleted. Review the archive integrity notice above before taking further action."
              action={selectedCategory ? (
                <button type="button" className="secondary-btn topic-filter-clear topic-filter-clear-empty" onClick={() => chooseCategory("")}>
                  <X size={14} aria-hidden="true" /><span>Clear category filter</span>
                </button>
              ) : null}
            />
          ) : selectedCategory ? (
            <EmptyState
              title={`No topics in ${selectedCategoryLabel}`}
              copy="There are no collections filed under this category yet. Clear the filter to see all your topics."
              action={
                <button type="button" className="secondary-btn topic-filter-clear topic-filter-clear-empty" onClick={() => chooseCategory("")}>
                  <X size={14} aria-hidden="true" /><span>Clear category filter</span>
                </button>
              }
            />
          ) : (
            <EmptyState
              title="Your archive starts here"
              copy="Create a collection for a subject, project, book or idea you want to develop. You can add notes, references and a cover whenever you're ready."
              action={<OpenTopicDialogButton className="primary-btn topic-archive-create-action" label="Create your first topic" />}
            />
          )}
        </div>
      )}
    </section>
  );
}

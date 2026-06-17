import { memo } from "react";
import { useI18n } from "@/i18n";
import type { Chapter, Volume } from "@/types";

interface ChapterSidebarProps {
  chapters: Chapter[];
  volumes: Volume[];
  activeId: number | null;
  sidebarOpen: boolean;
  onSelectChapter: (id: number) => void;
  onAddChapter: () => void;
  onDeleteChapter: (id: number) => void;
  onMoveChapter: (chapterId: number, volumeId: number | null) => void;
}

function ChapterSidebar({
  chapters,
  volumes,
  activeId,
  sidebarOpen,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onMoveChapter,
}: ChapterSidebarProps) {
  const { t } = useI18n();
  const sortedVolumes = volumes
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const grouped = [
    ...sortedVolumes.map((volume) => ({
      key: `volume-${volume.id}`,
      title: volume.title?.trim() || `第${volume.sort_order + 1}卷`,
      chapters: chapters.filter((chapter) => chapter.volume_id === volume.id),
    })),
    {
      key: "volume-none",
      title: "未分卷",
      chapters: chapters.filter((chapter) => !chapter.volume_id),
    },
  ].filter((group) => group.key !== "volume-none" || group.chapters.length > 0 || volumes.length === 0);

  let chapterIndex = 0;

  return (
    <aside className={`write-left-sidebar${sidebarOpen ? " is-open" : ""}`}>
      <div className="write-left-inner card">
        <div className="write-left-head">
          <strong>{t("write_chapters")}</strong>
          <button
            type="button"
            className="btn btn-ghost write-chapter-add-btn"
            onClick={(e) => {
              e.stopPropagation();
              void onAddChapter();
            }}
          >
            {t("write_new_chapter")}
          </button>
        </div>
        <div className="chapter-list stack-sm">
          {chapters.length === 0 ? (
            <p className="muted write-chapter-empty-hint">
              {t("write_no_chapters")}
            </p>
          ) : grouped.map((group) => (
            <div key={group.key} className="chapter-volume-group">
              <div className="chapter-volume-title">{group.title}</div>
              {group.chapters.length === 0 ? (
                <p className="muted write-chapter-empty-hint">暂无章节</p>
              ) : null}
              {group.chapters.map((c) => {
                chapterIndex += 1;
                return (
                  <div key={c.id} className="chapter-row">
                    <button
                      type="button"
                      className={`chapter-item${c.id === activeId ? " active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onSelectChapter(c.id);
                      }}
                    >
                      {`${t("write_chapter_n")}${chapterIndex}${t("write_chapter_n_suffix")}${c.title?.trim() ? ` ${c.title.trim()}` : ""}`}
                    </button>
                    {sortedVolumes.length > 0 ? (
                      <select
                        className="chapter-volume-select"
                        aria-label="移动章节到分卷"
                        value={c.volume_id ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const nextValue = e.currentTarget.value;
                          onMoveChapter(c.id, nextValue ? Number(nextValue) : null);
                        }}
                      >
                        <option value="">未分卷</option>
                        {sortedVolumes.map((volume) => (
                          <option key={volume.id} value={volume.id}>
                            {volume.title?.trim() || `第${volume.sort_order + 1}卷`}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="chapter-del"
                      title={t("write_delete_chapter")}
                      aria-label={t("write_delete_chapter")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteChapter(c.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default memo(ChapterSidebar);

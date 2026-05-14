import { memo } from "react";
import { useI18n } from "@/i18n";
import type { SelectionAiMode } from "./types";

interface SelectionFloatMenuProps {
  top: number;
  left: number;
  busy: boolean;
  onRunAi: (mode: SelectionAiMode) => void;
  onAddToMemo: () => void;
}

function SelectionFloatMenu({
  top,
  left,
  busy,
  onRunAi,
  onAddToMemo,
}: SelectionFloatMenuProps) {
  const { t } = useI18n();

  return (
    <div
      className="write-selection-float"
      role="toolbar"
      aria-label={t("write_selection_ai_aria")}
      style={{ top, left }}
    >
      <button type="button" className="write-selection-float__item" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void onRunAi("rewrite")}>
        {t("write_selection_rewrite")}
      </button>
      <button type="button" className="write-selection-float__item" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void onRunAi("expand")}>
        {t("write_selection_expand")}
      </button>
      <button type="button" className="write-selection-float__item" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void onRunAi("polish")}>
        {t("write_selection_polish")}
      </button>
      <button type="button" className="write-selection-float__item" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void onAddToMemo()}>
        {t("write_selection_to_memo")}
      </button>
    </div>
  );
}

export default memo(SelectionFloatMenu);

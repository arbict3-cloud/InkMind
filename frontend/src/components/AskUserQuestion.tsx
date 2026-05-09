import { useMemo, useState } from "react";
import type { PendingQuestionData, QuestionOption, RawQuestionOption } from "@/types/sse";
import { useI18n } from "@/i18n";

export interface AskUserQuestionProps {
  question: PendingQuestionData;
  onAnswer: (questionId: string, answer: string, selectedOption?: string) => void;
  disabled?: boolean;
}

export default function AskUserQuestion({ question, onAnswer, disabled }: AskUserQuestionProps) {
  const { t } = useI18n();
  const [customInput, setCustomInput] = useState("");
  const [selectedOption, setSelectedOption] = useState<QuestionOption | null>(null);

  const normalizedOptions = useMemo<QuestionOption[]>(() => {
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    return rawOptions
      .map((opt: RawQuestionOption) => {
        if (typeof opt === "string") {
          const label = opt.trim();
          return label ? { label } : null;
        }
        const label = opt?.label?.trim();
        return label ? { label, description: opt.description } : null;
      })
      .filter((opt): opt is QuestionOption => Boolean(opt));
  }, [question.options]);

  const fallbackOptions = useMemo<QuestionOption[]>(() => {
    if (normalizedOptions.length > 0) return [];
    return [
      {
        label: t("ai_question_default_decide"),
        description: t("ai_question_default_decide_desc"),
      },
      {
        label: t("ai_question_default_skip"),
        description: t("ai_question_default_skip_desc"),
      },
    ];
  }, [normalizedOptions.length, t]);

  const displayOptions = normalizedOptions.length > 0 ? normalizedOptions : fallbackOptions;
  const hasOptions = displayOptions.length > 0;
  const showCustomInput = question.allow_custom !== false || normalizedOptions.length === 0;

  const handleOptionClick = (opt: QuestionOption) => {
    setSelectedOption(opt);
    setCustomInput("");
    const cleanLabel = opt.label
      .replace(/\s*[\(（]\s*recommended\s*[\)）]\s*$/i, "")
      .trim();
    onAnswer(question.question_id, cleanLabel, cleanLabel);
  };

  const handleCustomSubmit = () => {
    if (customInput.trim()) {
      onAnswer(question.question_id, customInput.trim());
    }
  };

  return (
    <div className="ai-assistant-question">
      {question.header && (
        <div className="ai-assistant-question__header">{question.header}</div>
      )}
      <div className="ai-assistant-question__text">{question.question}</div>

      {hasOptions && (
        <div className="ai-assistant-question__options">
          {displayOptions.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              className={`ai-assistant-question__option${
                selectedOption?.label === opt.label ? " ai-assistant-question__option--selected" : ""
              }`}
              onClick={() => handleOptionClick(opt)}
              disabled={disabled}
            >
              <span className="ai-assistant-question__option-label">{opt.label}</span>
              {opt.description && (
                <span className="ai-assistant-question__option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {showCustomInput && (
        <div className="ai-assistant-question__custom">
          <input
            type="text"
            className="ai-assistant-question__input"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder={t("ai_question_custom_placeholder")}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInput.trim()) {
                e.preventDefault();
                handleCustomSubmit();
              }
            }}
          />
          <button
            type="button"
            className="ai-assistant-question__submit"
            onClick={handleCustomSubmit}
            disabled={disabled || !customInput.trim()}
          >
            {t("ai_question_submit")}
          </button>
        </div>
      )}
    </div>
  );
}

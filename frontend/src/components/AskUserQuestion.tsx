import { useState } from "react";
import type { PendingQuestionData } from "@/types/sse";
import { useI18n } from "@/i18n";

export interface AskUserQuestionProps {
  question: PendingQuestionData;
  onAnswer: (questionId: string, answer: string, selectedOption?: string) => void;
  disabled?: boolean;
}

export default function AskUserQuestion({ question, onAnswer, disabled }: AskUserQuestionProps) {
  const { t } = useI18n();
  const [customInput, setCustomInput] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const hasOptions = question.options && question.options.length > 0;

  const handleSubmit = () => {
    if (hasOptions && selectedIdx !== null) {
      const selected = question.options[selectedIdx];
      onAnswer(question.question_id, customInput.trim() || selected, selected);
    } else if (customInput.trim()) {
      onAnswer(question.question_id, customInput.trim());
    }
  };

  const handleOptionClick = (idx: number) => {
    setSelectedIdx(idx);
    setCustomInput("");
    onAnswer(question.question_id, question.options[idx], question.options[idx]);
  };

  return (
    <div className="ai-assistant-question">
      {question.header && (
        <div className="ai-assistant-question__header">{question.header}</div>
      )}
      <div className="ai-assistant-question__text">{question.question}</div>

      {hasOptions && (
        <div className="ai-assistant-question__options">
          {question.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              className={`ai-assistant-question__option${
                selectedIdx === idx ? " ai-assistant-question__option--selected" : ""
              }`}
              onClick={() => handleOptionClick(idx)}
              disabled={disabled}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {question.allow_custom && (
        <div className="ai-assistant-question__custom">
          <input
            type="text"
            className="ai-assistant-question__input"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder={t("ai_question_custom_placeholder") || "输入你的回答..."}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInput.trim()) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            type="button"
            className="ai-assistant-question__submit"
            onClick={handleSubmit}
            disabled={disabled || !customInput.trim()}
          >
            {t("ai_question_submit") || "提交"}
          </button>
        </div>
      )}
    </div>
  );
}

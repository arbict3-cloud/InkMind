import { useState } from "react";
import type { PendingQuestionData, QuestionOption } from "@/types/sse";
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

  const hasOptions = question.options && question.options.length > 0;

  const handleOptionClick = (opt: QuestionOption) => {
    setSelectedOption(opt);
    setCustomInput("");
    onAnswer(question.question_id, opt.label, opt.label);
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
          {question.options.map((opt, idx) => (
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
          {t("ai_question_submit") || "提交"}
        </button>
      </div>
    </div>
  );
}

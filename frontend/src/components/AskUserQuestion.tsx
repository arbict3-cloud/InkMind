import { useMemo, useState } from "react";
import type { PendingQuestionData, QuestionItem, QuestionOption, RawQuestionOption } from "@/types/sse";
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
  const [currentStep, setCurrentStep] = useState(0);

  const steps = useMemo<QuestionItem[]>(() => {
    if (question.questions && question.questions.length > 0) {
      return question.questions;
    }
    return [{ question: question.question || "", options: question.options || [] }];
  }, [question]);

  const currentQ = steps[currentStep] || steps[0];
  const isLastStep = currentStep >= steps.length - 1;
  const isMultiStep = steps.length > 1;

  const normalizedOptions = useMemo<QuestionOption[]>(() => {
    const rawOptions = Array.isArray(currentQ.options) ? currentQ.options : [];
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
  }, [currentQ.options]);

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
    if (isLastStep) {
      onAnswer(question.question_id, cleanLabel, cleanLabel);
    }
  };

  const handleCustomSubmit = () => {
    if (customInput.trim()) {
      onAnswer(question.question_id, customInput.trim());
    }
  };

  const handleNextStep = () => {
    if (!selectedOption && !customInput.trim()) return;
    const answer = selectedOption?.label || customInput.trim();
    if (currentStep < steps.length - 1) {
      setSelectedOption(null);
      setCustomInput("");
      setCurrentStep(currentStep + 1);
    } else {
      onAnswer(question.question_id, answer, selectedOption?.label);
    }
  };

  return (
    <div className="ai-assistant-question">
      {isMultiStep && (
        <div className="ai-assistant-question__steps">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`ai-assistant-question__step-dot${
                idx === currentStep ? " ai-assistant-question__step-dot--active" : ""
              }${idx < currentStep ? " ai-assistant-question__step-dot--done" : ""}`}
            />
          ))}
        </div>
      )}

      {question.header && (
        <div className="ai-assistant-question__header">{question.header}</div>
      )}
      <div className="ai-assistant-question__text">{currentQ.question || question.question}</div>

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
                if (isLastStep) {
                  handleCustomSubmit();
                } else {
                  handleNextStep();
                }
              }
            }}
          />
          <button
            type="button"
            className="ai-assistant-question__submit"
            onClick={isLastStep ? handleCustomSubmit : handleNextStep}
            disabled={disabled || !customInput.trim()}
          >
            {isLastStep ? t("ai_question_submit") : t("ai_question_next")}
          </button>
        </div>
      )}

      {isMultiStep && !showCustomInput && (
        <div className="ai-assistant-question__nav">
          {currentStep > 0 && (
            <button
              type="button"
              className="ai-assistant-question__nav-btn ai-assistant-question__nav-btn--prev"
              onClick={() => {
                setCurrentStep(currentStep - 1);
                setSelectedOption(null);
                setCustomInput("");
              }}
              disabled={disabled}
            >
              {t("ai_question_prev")}
            </button>
          )}
          <button
            type="button"
            className="ai-assistant-question__nav-btn ai-assistant-question__nav-btn--next"
            onClick={handleNextStep}
            disabled={disabled || (!selectedOption && !customInput.trim())}
          >
            {isLastStep ? t("ai_question_submit") : t("ai_question_next")}
          </button>
        </div>
      )}
    </div>
  );
}

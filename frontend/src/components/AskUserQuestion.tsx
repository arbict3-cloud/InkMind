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
  const [answers, setAnswers] = useState<Record<number, string>>({});

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

  const cleanOptionLabel = (label: string) => (
    label
      .replace(/\s*[\(（]\s*recommended\s*[\)）]\s*$/i, "")
      .trim()
  );

  const currentAnswer = selectedOption ? cleanOptionLabel(selectedOption.label) : customInput.trim();
  const canProceed = Boolean(currentAnswer);

  const buildAnswerPayload = (nextAnswers: Record<number, string>) => {
    if (!isMultiStep) return nextAnswers[currentStep] || "";

    const keyedAnswers = steps.reduce<Record<string, string>>((acc, step, idx) => {
      const key = step.question || `${idx + 1}`;
      const answer = nextAnswers[idx];
      if (answer) acc[key] = answer;
      return acc;
    }, {});

    return JSON.stringify(keyedAnswers);
  };

  const buildDisplayAnswer = (nextAnswers: Record<number, string>) => {
    if (!isMultiStep) return nextAnswers[currentStep] || "";

    return steps
      .map((step, idx) => {
        const answer = nextAnswers[idx];
        if (!answer) return "";
        return `${step.header || step.question || `${idx + 1}`}: ${answer}`;
      })
      .filter(Boolean)
      .join("\n");
  };

  const handleOptionClick = (opt: QuestionOption) => {
    setSelectedOption(opt);
    setCustomInput("");
    const cleanLabel = cleanOptionLabel(opt.label);
    if (isLastStep && !isMultiStep) {
      onAnswer(question.question_id, cleanLabel, cleanLabel);
    }
  };

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return;
    const nextAnswers = { ...answers, [currentStep]: customInput.trim() };
    onAnswer(question.question_id, buildAnswerPayload(nextAnswers), buildDisplayAnswer(nextAnswers));
  };

  const handleNextStep = () => {
    if (!canProceed) return;
    const nextAnswers = { ...answers, [currentStep]: currentAnswer };
    if (currentStep < steps.length - 1) {
      setAnswers(nextAnswers);
      setSelectedOption(null);
      setCustomInput("");
      setCurrentStep(currentStep + 1);
    } else {
      onAnswer(question.question_id, buildAnswerPayload(nextAnswers), buildDisplayAnswer(nextAnswers));
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
            onClick={isMultiStep ? handleNextStep : handleCustomSubmit}
            disabled={disabled || !canProceed}
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
            disabled={disabled || !canProceed}
          >
            {isLastStep ? t("ai_question_submit") : t("ai_question_next")}
          </button>
        </div>
      )}
    </div>
  );
}

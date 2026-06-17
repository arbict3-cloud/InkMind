import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  BulbOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  RocketOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createChapter,
  createCharacter,
  createMemo,
  createVolume,
  fetchChapters,
  fetchCharacters,
  fetchLlmProviders,
  fetchMemos,
  fetchNovel,
  fetchVolumes,
  generateWorkflowStage,
  updateChapter,
  updateMemo,
} from "@/api/client";
import type { BuiltinProviderInfo, Chapter, Character, Memo, Novel, Volume } from "@/types";

const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

type StageKey = "world" | "story" | "character" | "book" | "volume" | "chapter" | "body" | "planner";

type StageModelConfig = {
  provider: string;
  model: string;
};

type StageConfigMap = Record<StageKey, StageModelConfig>;
type DraftMap = Record<StageKey, string>;
type FlowSlot = number;
type FlowInfo = {
  id: FlowSlot;
  name: string;
};

const DEFAULT_FLOWS: FlowInfo[] = [
  { id: 1, name: "流程1" },
  { id: 2, name: "流程2" },
  { id: 3, name: "流程3" },
];

const ACCEPTED_MEMO_TITLES: Partial<Record<StageKey, string>> = {
  world: "【AI创作工作台】已采纳世界观",
  story: "【AI创作工作台】已采纳故事创意",
  character: "【AI创作工作台】已采纳人物卡",
  book: "【AI创作工作台】已采纳全书大纲",
  volume: "【AI创作工作台】已采纳卷大纲",
  chapter: "【AI创作工作台】已采纳章节大纲",
  planner: "【AI创作工作台】已采纳策划建议",
};

const DEFAULT_STAGE_CONFIG: StageConfigMap = {
  world: { provider: "deepseek", model: "deepseek-v4-flash" },
  story: { provider: "deepseek", model: "deepseek-v4-flash" },
  character: { provider: "deepseek", model: "deepseek-v4-flash" },
  book: { provider: "deepseek", model: "deepseek-v4-flash" },
  volume: { provider: "deepseek", model: "deepseek-v4-flash" },
  chapter: { provider: "deepseek", model: "deepseek-v4-flash" },
  body: { provider: "deepseek", model: "deepseek-v4-flash" },
  planner: { provider: "deepseek", model: "deepseek-v4-flash" },
};

const FALLBACK_PROVIDERS: BuiltinProviderInfo[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    default_model: "deepseek-v4-flash",
  },
  {
    id: "qwen",
    label: "Qwen / 通义千问",
    models: ["qwen3-max", "qwen3.6-plus", "qwen3.6-max-preview", "qwen3.6-flash"],
    default_model: "qwen3-max",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    models: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite"],
    default_model: "gemini-3-flash-preview",
  },
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    default_model: "gpt-4o-mini",
  },
  {
    id: "kimi",
    label: "Kimi / 月之暗面",
    models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-32k", "moonshot-v1-128k"],
    default_model: "kimi-k2.5",
  },
  {
    id: "glm",
    label: "GLM / 智谱",
    models: ["GLM-5.1", "GLM-4.7-FlashX"],
    default_model: "GLM-5.1",
  },
  {
    id: "minimax",
    label: "MiniMax",
    models: ["MiniMax-M2.7", "MiniMax-M2.5"],
    default_model: "MiniMax-M2.7",
  },
];

const EMPTY_DRAFTS: DraftMap = {
  world: "",
  story: "",
  character: "",
  book: "",
  volume: "",
  chapter: "",
  body: "",
  planner: "",
};

const STAGE_MODEL_MIGRATION_VERSION = "deepseek-v4-flash-test-v1";

const STAGES: Array<{
  key: StageKey;
  title: string;
  shortTitle: string;
  description: string;
  placeholder: string;
  acceptedLabel: string;
  icon: ReactNode;
}> = [
  {
    key: "world",
    title: "世界观生成",
    shortTitle: "世界观",
    description: "先确定故事发生在什么背景下，也可以输入参考作品拆解，让 AI 抽象结构后生成原创世界观。",
    placeholder: "例：我想要一个修仙世界；或者粘贴《进击的巨人》世界观拆解，要求生成一个原创的异能封锁世界。",
    acceptedLabel: "已采纳世界观",
    icon: <ProjectOutlined />,
  },
  {
    key: "story",
    title: "故事创意",
    shortTitle: "故事",
    description: "基于已采纳世界观，提出这个世界里最有意思、最适合长篇展开的故事。",
    placeholder: "补充你想要的主角类型、爽点、黑暗程度、感情线、反转方向；也可以留空直接生成。",
    acceptedLabel: "已采纳故事创意",
    icon: <BulbOutlined />,
  },
  {
    key: "character",
    title: "角色设定",
    shortTitle: "角色",
    description: "根据世界观和故事创意生成角色卡，让人物性格、欲望和冲突服务剧情。",
    placeholder: "补充主角性别、年龄、性格偏好、CP 或反派要求；也可以要求生成群像。",
    acceptedLabel: "已采纳人物卡",
    icon: <TeamOutlined />,
  },
  {
    key: "book",
    title: "全书大纲",
    shortTitle: "全书",
    description: "根据世界观、故事创意和人物卡，生成详细长篇全书大纲。",
    placeholder: "补充预计字数、卷数、结局类型、节奏偏快还是偏慢。",
    acceptedLabel: "已采纳全书大纲",
    icon: <FileTextOutlined />,
  },
  {
    key: "volume",
    title: "卷大纲",
    shortTitle: "卷纲",
    description: "把全书大纲拆成若干卷，每卷都有目标、冲突、高潮和钩子。",
    placeholder: "补充想要几卷、每卷大概多少章、哪一卷重点写感情/战争/揭秘。",
    acceptedLabel: "已采纳卷大纲",
    icon: <FolderOpenOutlined />,
  },
  {
    key: "chapter",
    title: "章节大纲",
    shortTitle: "章纲",
    description: "把卷大纲拆成每章剧情概要，后续正文按章生成。",
    placeholder: "补充要拆哪一卷、预计多少章、章节节奏要求。",
    acceptedLabel: "已采纳章节大纲",
    icon: <FileTextOutlined />,
  },
  {
    key: "body",
    title: "正文生成",
    shortTitle: "正文",
    description: "选择目标章节和字数，根据已采纳内容生成正文初稿。",
    placeholder: "补充本章特殊要求，例如更悬疑、更热血、增加对话、控制节奏等。",
    acceptedLabel: "正文会保存到目标章节",
    icon: <EditOutlined />,
  },
  {
    key: "planner",
    title: "策划分析",
    shortTitle: "策划",
    description: "读取所有已采纳内容和章节，提出更有趣、更合理的剧情和人物优化建议。",
    placeholder: "例：帮我分析哪里不够有趣；哪里可以加反转；人物动机哪里薄弱。",
    acceptedLabel: "已采纳策划建议",
    icon: <RocketOutlined />,
  },
];

function makeStorageKey(novelId: number) {
  return `inkmind.story-workbench.stage-models.${novelId}`;
}

function makeDraftStorageKey(novelId: number) {
  return `inkmind.story-workbench.drafts.${novelId}`;
}

function makeFlowDraftStorageKey(novelId: number, flowSlot: FlowSlot) {
  return flowSlot === 1
    ? makeDraftStorageKey(novelId)
    : `inkmind.story-workbench.drafts.${novelId}.flow-${flowSlot}`;
}

function makeActiveFlowStorageKey(novelId: number) {
  return `inkmind.story-workbench.active-flow.${novelId}`;
}

function makeFlowListStorageKey(novelId: number) {
  return `inkmind.story-workbench.flows.${novelId}`;
}

function makeMigrationKey(novelId: number) {
  return `inkmind.story-workbench.stage-models-migration.${novelId}`;
}

function acceptedMemoTitle(stage: StageKey, flowSlot: FlowSlot) {
  const base = ACCEPTED_MEMO_TITLES[stage];
  if (!base) return undefined;
  if (flowSlot === 1) return base;
  return base.replace("【AI创作工作台】", `【AI创作工作台·流程${flowSlot}】`);
}

function findMemoByTitle(memos: Memo[], title?: string) {
  if (!title) return undefined;
  return memos.find((memo) => memo.title.trim() === title);
}

function getAccepted(memos: Memo[], stage: StageKey, flowSlot: FlowSlot) {
  return findMemoByTitle(memos, acceptedMemoTitle(stage, flowSlot))?.body || "";
}

function parseBlocks(raw: string) {
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parsePlanItems(raw: string, fallbackPrefix: string) {
  return parseBlocks(raw).map((block, index) => {
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const first = lines[0] || `${fallbackPrefix}${index + 1}`;
    const title = first
      .replace(/^[0-9]+[.、\s-]*/, "")
      .replace(/^第[一二三四五六七八九十百千万0-9]+[卷章][：:\s-]*/, "")
      .slice(0, 80);
    const summary = lines.length > 1 ? lines.slice(1).join("\n") : block;
    return {
      title: title || `${fallbackPrefix}${index + 1}`,
      summary,
    };
  });
}

function parseCharacterCards(raw: string) {
  return parseBlocks(raw).map((block, index) => {
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const first = lines[0] || `角色${index + 1}`;
    const name = first
      .replace(/^[0-9]+[.、\s-]*/, "")
      .replace(/^(角色|人物|姓名|名称)[：:\s]*/, "")
      .slice(0, 80);
    return {
      name: name || `角色${index + 1}`,
      profile: block,
      notes: "由 AI 创作工作台的人物卡模块采纳生成。",
    };
  });
}

function previewText(text: string, limit = 420) {
  const trimmed = text.trim();
  if (!trimmed) return "尚未保存采纳。";
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function readDraftCache(novelId: number, flowSlot: FlowSlot): DraftMap {
  try {
    const raw = window.localStorage.getItem(makeFlowDraftStorageKey(novelId, flowSlot));
    if (!raw) return EMPTY_DRAFTS;
    return { ...EMPTY_DRAFTS, ...JSON.parse(raw) };
  } catch {
    return EMPTY_DRAFTS;
  }
}

function writeDraftCache(novelId: number, flowSlot: FlowSlot, drafts: DraftMap) {
  window.localStorage.setItem(makeFlowDraftStorageKey(novelId, flowSlot), JSON.stringify(drafts));
}

function readFlowList(novelId: number): FlowInfo[] {
  try {
    const raw = window.localStorage.getItem(makeFlowListStorageKey(novelId));
    if (!raw) return DEFAULT_FLOWS;
    const parsed = JSON.parse(raw) as FlowInfo[];
    const clean = parsed
      .filter((item) => Number.isFinite(item.id))
      .map((item) => ({
        id: Number(item.id),
        name: String(item.name || `流程${item.id}`),
      }));
    return clean.length ? clean : DEFAULT_FLOWS;
  } catch {
    return DEFAULT_FLOWS;
  }
}

function writeFlowList(novelId: number, flows: FlowInfo[]) {
  window.localStorage.setItem(makeFlowListStorageKey(novelId), JSON.stringify(flows));
}

function readActiveFlow(novelId: number, flows: FlowInfo[]): FlowSlot {
  const raw = Number(window.localStorage.getItem(makeActiveFlowStorageKey(novelId)));
  return flows.some((item) => item.id === raw) ? raw : flows[0]?.id || 1;
}

function writeActiveFlow(novelId: number, flowSlot: FlowSlot) {
  window.localStorage.setItem(makeActiveFlowStorageKey(novelId), String(flowSlot));
}

export default function NovelWorkflow() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [providers, setProviders] = useState<BuiltinProviderInfo[]>([]);
  const [models, setModels] = useState<StageConfigMap>(DEFAULT_STAGE_CONFIG);
  const [drafts, setDrafts] = useState<DraftMap>(EMPTY_DRAFTS);
  const [flows, setFlows] = useState<FlowInfo[]>(DEFAULT_FLOWS);
  const [activeFlow, setActiveFlow] = useState<FlowSlot>(1);
  const [activeStage, setActiveStage] = useState<StageKey>("world");
  const [targetChapterId, setTargetChapterId] = useState<number | null>(null);
  const [targetWords, setTargetWords] = useState(3000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<StageKey | null>(null);
  const [generating, setGenerating] = useState<StageKey | null>(null);
  const [err, setErr] = useState("");

  const stage = STAGES.find((item) => item.key === activeStage) || STAGES[0];
  const accepted = useMemo(() => ({
    world: getAccepted(memos, "world", activeFlow),
    story: getAccepted(memos, "story", activeFlow),
    character: getAccepted(memos, "character", activeFlow),
    book: getAccepted(memos, "book", activeFlow),
    volume: getAccepted(memos, "volume", activeFlow),
    chapter: getAccepted(memos, "chapter", activeFlow),
    body: "",
    planner: getAccepted(memos, "planner", activeFlow),
  }), [memos, activeFlow]);

  const completed = useMemo<Record<StageKey, boolean>>(() => ({
    world: !!accepted.world.trim(),
    story: !!accepted.story.trim(),
    character: !!accepted.character.trim(),
    book: !!accepted.book.trim(),
    volume: !!accepted.volume.trim(),
    chapter: !!accepted.chapter.trim(),
    body: chapters.some((chapter) => chapter.content.trim()),
    planner: !!accepted.planner.trim(),
  }), [accepted, chapters]);

  const currentIndex = Math.max(0, STAGES.findIndex((item) => !completed[item.key]));
  const acceptedContext = {
    world: accepted.world,
    story: accepted.story,
    characters: accepted.character,
    book_outline: accepted.book,
    volume_outline: accepted.volume,
    chapter_outline: accepted.chapter,
    planner_notes: accepted.planner,
  };

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const saved = window.localStorage.getItem(makeStorageKey(id));
    const migrationKey = makeMigrationKey(id);
    const migrated = window.localStorage.getItem(migrationKey) === STAGE_MODEL_MIGRATION_VERSION;
    if (!migrated) {
      window.localStorage.setItem(makeStorageKey(id), JSON.stringify(DEFAULT_STAGE_CONFIG));
      window.localStorage.setItem(migrationKey, STAGE_MODEL_MIGRATION_VERSION);
      setModels(DEFAULT_STAGE_CONFIG);
      return;
    }
    if (saved) {
      try {
        setModels({ ...DEFAULT_STAGE_CONFIG, ...JSON.parse(saved) });
      } catch {
        setModels(DEFAULT_STAGE_CONFIG);
      }
    }
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const savedFlows = readFlowList(id);
    setFlows(savedFlows);
    setActiveFlow(readActiveFlow(id, savedFlows));
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const cached = readDraftCache(id, activeFlow);
    const next = {
      ...cached,
      world: getAccepted(memos, "world", activeFlow) || cached.world || (activeFlow === 1 ? novel?.background || "" : ""),
      story: getAccepted(memos, "story", activeFlow) || cached.story,
      character: getAccepted(memos, "character", activeFlow) || cached.character,
      book: getAccepted(memos, "book", activeFlow) || cached.book,
      volume: getAccepted(memos, "volume", activeFlow) || cached.volume,
      chapter: getAccepted(memos, "chapter", activeFlow) || cached.chapter,
      planner: getAccepted(memos, "planner", activeFlow) || cached.planner,
    };
    setDrafts(next);
    writeDraftCache(id, activeFlow, next);
  }, [id, activeFlow, memos, novel?.background]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void loadAll();
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    setModels((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of STAGES) {
        const current = prev[item.key];
        const fixedModel = ensureModelForProvider(current.provider, current.model);
        if (fixedModel !== current.model) {
          changed = true;
          next[item.key] = {
            ...current,
            model: fixedModel,
          };
        }
      }
      if (changed) {
        window.localStorage.setItem(makeStorageKey(id), JSON.stringify(next));
      }
      return changed ? next : prev;
    });
  }, [providers, id]);

  async function loadAll() {
    setLoading(true);
    setErr("");
    try {
      const [novelData, memoList, chapterList, characterList, volumeList, providerData] = await Promise.all([
        fetchNovel(id),
        fetchMemos(id),
        fetchChapters(id),
        fetchCharacters(id),
        fetchVolumes(id),
        fetchLlmProviders(),
      ]);
      setNovel(novelData);
      setMemos(memoList);
      setChapters(chapterList);
      setCharacters(characterList);
      setVolumes(volumeList);
      setProviders(providerData.builtin);
      setTargetChapterId(chapterList.find((chapter) => !chapter.content.trim())?.id || chapterList[0]?.id || null);
      setDrafts((prev) => {
        const legacyBackground = activeFlow === 1 ? novelData.background || "" : "";
        const next = {
          ...prev,
          world: getAccepted(memoList, "world", activeFlow) || prev.world || legacyBackground,
          story: getAccepted(memoList, "story", activeFlow) || prev.story,
          character: getAccepted(memoList, "character", activeFlow) || prev.character,
          book: getAccepted(memoList, "book", activeFlow) || prev.book,
          volume: getAccepted(memoList, "volume", activeFlow) || prev.volume,
          chapter: getAccepted(memoList, "chapter", activeFlow) || prev.chapter,
          planner: getAccepted(memoList, "planner", activeFlow) || prev.planner,
        };
        writeDraftCache(id, activeFlow, next);
        return next;
      });
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function providerOptions() {
    const providerList = providers.length ? providers : FALLBACK_PROVIDERS;
    return providerList.map((provider) => ({
      label: provider.label,
      value: provider.id,
    }));
  }

  function findProviderInfo(providerId: string) {
    return [...providers, ...FALLBACK_PROVIDERS].find((item) => item.id === providerId);
  }

  function ensureModelForProvider(providerId: string, model?: string) {
    const provider = findProviderInfo(providerId);
    const knownModels = provider?.models ?? [];
    if (model && knownModels.includes(model)) return model;
    return provider?.default_model || knownModels[0] || model || "";
  }

  function modelOptions(stageKey: StageKey) {
    const provider = findProviderInfo(models[stageKey].provider);
    const knownModels = provider?.models ?? [];
    const current = models[stageKey].model;
    const allowedModels = knownModels.length ? knownModels : [current].filter(Boolean);
    return allowedModels.map((model) => ({
      label: model,
      value: model,
    }));
  }

  function changeStageProvider(stageKey: StageKey, provider: string) {
    updateStageModel(stageKey, {
      provider,
      model: ensureModelForProvider(provider),
    });
  }

  function updateStageModel(stageKey: StageKey, patch: Partial<StageModelConfig>) {
    setModels((prev) => {
      const next = {
        ...prev,
        [stageKey]: {
          ...prev[stageKey],
          ...patch,
        },
      };
      window.localStorage.setItem(makeStorageKey(id), JSON.stringify(next));
      return next;
    });
  }

  function updateDraft(stageKey: StageKey, value: string) {
    setDrafts((prev) => {
      const next = {
        ...prev,
        [stageKey]: value,
      };
      if (Number.isFinite(id)) {
        writeDraftCache(id, activeFlow, next);
      }
      return next;
    });
  }

  function changeFlow(flowSlot: FlowSlot) {
    if (!Number.isFinite(id)) return;
    writeActiveFlow(id, flowSlot);
    setActiveFlow(flowSlot);
    setDrafts(readDraftCache(id, flowSlot));
    setActiveStage("world");
  }

  function createFlow() {
    if (!Number.isFinite(id)) return;
    const nextId = Math.max(0, ...flows.map((item) => item.id)) + 1;
    const next = [...flows, { id: nextId, name: `流程${nextId}` }];
    writeFlowList(id, next);
    setFlows(next);
    changeFlow(nextId);
    message.success(`已新建流程${nextId}`);
  }

  async function upsertAcceptedMemo(stageKey: StageKey, body: string) {
    const title = acceptedMemoTitle(stageKey, activeFlow);
    if (!title) return null;
    const existing = findMemoByTitle(memos, title);
    const saved = existing
      ? await updateMemo(id, existing.id, { title, body })
      : await createMemo(id, { title, body });
    setMemos((prev) => [saved, ...prev.filter((memo) => memo.id !== saved.id)]);
    return saved;
  }

  async function saveAccepted(stageKey: StageKey) {
    const body = drafts[stageKey].trim();
    if (!body && stageKey !== "body") {
      message.warning("请先生成或填写草稿内容。");
      return;
    }
    setSaving(stageKey);
    setErr("");
    try {
      if (stageKey === "body") {
        await saveBodyDraftToChapter();
        return;
      }
      await upsertAcceptedMemo(stageKey, body);
      updateDraft(stageKey, body);
      message.success(`${stage.acceptedLabel}已保存`);
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("保存失败");
    } finally {
      setSaving(null);
    }
  }

  async function createCharacterRecords() {
    const cards = parseCharacterCards(drafts.character);
    if (!cards.length) {
      message.warning("请先填写人物卡草稿。");
      return;
    }
    setSaving("character");
    try {
      const created: Character[] = [];
      for (const card of cards) {
        created.push(await createCharacter(id, card));
      }
      setCharacters((prev) => [...prev, ...created]);
      message.success(`已创建 ${created.length} 张人物记录`);
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("创建人物失败");
    } finally {
      setSaving(null);
    }
  }

  async function createVolumeDrafts() {
    const plans = parsePlanItems(drafts.volume, "卷");
    if (!plans.length) {
      message.warning("请先填写卷大纲草稿。");
      return;
    }
    setSaving("volume");
    try {
      const startOrder = volumes.length ? Math.max(...volumes.map((volume) => volume.sort_order)) + 1 : 0;
      const created: Volume[] = [];
      for (const [index, plan] of plans.entries()) {
        created.push(await createVolume(id, {
          title: plan.title,
          summary: plan.summary,
          sort_order: startOrder + index,
        }));
      }
      setVolumes((prev) => [...prev, ...created]);
      message.success(`已创建 ${created.length} 个卷目录`);
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("创建卷目录失败");
    } finally {
      setSaving(null);
    }
  }

  async function createChapterDrafts() {
    const plans = parsePlanItems(drafts.chapter, "第");
    if (!plans.length) {
      message.warning("请先填写章节大纲草稿。");
      return;
    }
    setSaving("chapter");
    try {
      const startOrder = chapters.length ? Math.max(...chapters.map((chapter) => chapter.sort_order)) + 1 : 0;
      const created: Chapter[] = [];
      for (const [index, plan] of plans.entries()) {
        created.push(await createChapter(id, {
          title: plan.title,
          summary: plan.summary,
          content: "",
          sort_order: startOrder + index,
        }));
      }
      setChapters((prev) => [...prev, ...created]);
      setTargetChapterId(created[0]?.id || targetChapterId);
      message.success(`已创建 ${created.length} 个章节草稿`);
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("创建章节失败");
    } finally {
      setSaving(null);
    }
  }

  async function saveBodyDraftToChapter() {
    const body = drafts.body.trim();
    if (!body) {
      message.warning("正文草稿为空。");
      return;
    }
    if (!targetChapterId) {
      message.warning("请先选择目标章节。");
      return;
    }
    const updated = await updateChapter(id, targetChapterId, {
      content: body,
      skip_version: true,
    });
    setChapters((prev) => prev.map((chapter) => chapter.id === updated.id ? updated : chapter));
    message.success("正文已保存到目标章节");
  }

  async function runAiStage(stageKey: StageKey) {
    if (stageKey === "story" && !accepted.world.trim()) {
      message.warning("请先在世界观模块保存采纳内容。");
      return;
    }
    if (stageKey === "character" && (!accepted.world.trim() || !accepted.story.trim())) {
      message.warning("请先保存采纳世界观和故事创意。");
      return;
    }
    if (stageKey === "book" && (!accepted.world.trim() || !accepted.story.trim())) {
      message.warning("请先保存采纳世界观和故事创意。");
      return;
    }
    if (stageKey === "volume" && !accepted.book.trim()) {
      message.warning("请先保存采纳全书大纲。");
      return;
    }
    if (stageKey === "chapter" && !accepted.volume.trim() && !volumes.length) {
      message.warning("请先保存采纳卷大纲。");
      return;
    }
    if (stageKey === "body" && !targetChapterId) {
      message.warning("请先在章节大纲模块创建章节草稿。");
      return;
    }

    const rawConfig = models[stageKey];
    const config = {
      ...rawConfig,
      model: ensureModelForProvider(rawConfig.provider, rawConfig.model),
    };
    setErr("");
    setGenerating(stageKey);
    let streamed = "";
    updateDraft(stageKey, "");
    try {
      const result = await generateWorkflowStage(
        id,
        {
          stage: stageKey,
          provider: config.provider,
          model: config.model,
          reference_text: drafts[stageKey],
          ...acceptedContext,
          target_chapter_id: targetChapterId,
          target_words: targetWords,
        },
        (chunk) => {
          streamed += chunk;
          updateDraft(stageKey, streamed);
        }
      );
      updateDraft(stageKey, result.text || streamed);
      message.success("AI 已生成草稿，确认后请点击保存采纳。");
    } catch (e) {
      const errorMessage = apiErrorMessage(e);
      setErr(errorMessage);
      message.error(`AI 生成失败：${errorMessage}`);
    } finally {
      setGenerating(null);
    }
  }

  function copyPrompt(stageKey: StageKey) {
    const prompt = [
      `阶段：${STAGES.find((item) => item.key === stageKey)?.title}`,
      `当前补充要求：\n${drafts[stageKey] || "无"}`,
      `已采纳世界观：\n${acceptedContext.world || "无"}`,
      `已采纳故事创意：\n${acceptedContext.story || "无"}`,
      `已采纳人物卡：\n${acceptedContext.characters || "无"}`,
      `已采纳全书大纲：\n${acceptedContext.book_outline || "无"}`,
      `已采纳卷大纲：\n${acceptedContext.volume_outline || "无"}`,
      `已采纳章节大纲：\n${acceptedContext.chapter_outline || "无"}`,
    ].join("\n\n");
    void navigator.clipboard.writeText(prompt);
    message.success("提示词上下文已复制");
  }

  const activeRawModel = models[activeStage];
  const activeModel = {
    ...activeRawModel,
    model: ensureModelForProvider(activeRawModel.provider, activeRawModel.model),
  };
  const activeFlowName = flows.find((item) => item.id === activeFlow)?.name || `流程${activeFlow}`;
  const chapterOptions = chapters.map((chapter, index) => ({
    label: `${index + 1}. ${chapter.title || "未命名章节"}${chapter.content.trim() ? "（已有正文）" : ""}`,
    value: chapter.id,
  }));

  if (loading) {
    return (
      <div className="story-workbench-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="story-workbench">
      {err ? (
        <Alert
          message="操作失败"
          description={err}
          type="error"
          showIcon
          closable
          onClose={() => setErr("")}
          className="story-workbench-alert"
        />
      ) : null}

      <Card className="story-workbench-hero">
        <div className="story-workbench-hero__main">
          <div>
            <Text type="secondary">AI 长篇小说创作工作台</Text>
            <Title level={3}>{novel?.title || "未命名作品"} · {activeFlowName}</Title>
            <Paragraph>
              每个故事方案都是一条独立创作线，可以从全新的世界观开始。
              方案内按“世界观 → 故事 → 角色 → 全书 → 卷 → 章节 → 正文 → 策划”的顺序分开生成。
            </Paragraph>
          </div>
          <Space wrap>
            <Link to={`/novels/${id}/write`}>
              <Button type="primary" icon={<EditOutlined />}>进入写作页</Button>
            </Link>
            <Button onClick={() => void loadAll()}>刷新状态</Button>
          </Space>
        </div>
        <div className="story-flow-switcher">
          <Text type="secondary">当前故事方案</Text>
          <Space wrap>
            {flows.map((flow) => (
              <Button
                key={flow.id}
                type={activeFlow === flow.id ? "primary" : "default"}
                onClick={() => changeFlow(flow.id)}
              >
                {flow.name}
              </Button>
            ))}
            <Button onClick={createFlow}>新建流程</Button>
          </Space>
          <Text type="secondary" className="story-flow-switcher__hint">
            可以按需一直新建故事方案；各流程的草稿和采纳内容互不覆盖，作品级章节、人物记录仍在右侧统一查看。
          </Text>
        </div>
        <Row gutter={[12, 12]} className="story-workbench-stats">
          <Col xs={12} md={6}><Statistic title={`${activeFlowName}采纳模块`} value={STAGES.filter((item) => completed[item.key]).length} suffix="/ 8" /></Col>
          <Col xs={12} md={6}><Statistic title="作品级人物记录" value={characters.length} /></Col>
          <Col xs={12} md={6}><Statistic title="作品级卷目录" value={volumes.length} /></Col>
          <Col xs={12} md={6}><Statistic title="作品级章节" value={chapters.length} /></Col>
        </Row>
      </Card>

      <div className="story-workbench-layout">
        <aside className="story-stage-nav">
          {STAGES.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={`story-stage-nav__item${activeStage === item.key ? " is-active" : ""}${completed[item.key] ? " is-done" : ""}`}
              onClick={() => setActiveStage(item.key)}
            >
              <span className="story-stage-nav__index">{completed[item.key] ? <CheckCircleOutlined /> : index + 1}</span>
              <span className="story-stage-nav__body">
                <strong>{item.shortTitle}</strong>
                <small>{completed[item.key] ? "已采纳/已生成" : index === currentIndex ? "当前建议步骤" : "待处理"}</small>
              </span>
            </button>
          ))}
        </aside>

        <main className="story-stage-main">
          <Card className="story-stage-card">
            <div className="story-stage-card__head">
              <Space align="start">
                <span className="story-stage-card__icon">{stage.icon}</span>
                <div>
                  <Title level={4}>{stage.title}</Title>
                  <Paragraph type="secondary">{stage.description}</Paragraph>
                </div>
              </Space>
              <Tag color={completed[activeStage] ? "green" : "default"}>{completed[activeStage] ? "已有采纳内容" : "未采纳"}</Tag>
            </div>

            <Row gutter={[12, 12]} className="story-stage-controls">
              <Col xs={24} md={8}>
                <Text type="secondary">模型供应商</Text>
                <Select
                  value={activeModel.provider}
                  options={providerOptions()}
                  onChange={(provider) => changeStageProvider(activeStage, provider)}
                  className="story-stage-control"
                />
              </Col>
              <Col xs={24} md={10}>
                <Text type="secondary">模型</Text>
                <Select
                  value={activeModel.model}
                  options={modelOptions(activeStage)}
                  onChange={(model) => updateStageModel(activeStage, { model })}
                  className="story-stage-control"
                />
              </Col>
              {activeStage === "body" ? (
                <Col xs={24} md={6}>
                  <Text type="secondary">目标字数</Text>
                  <InputNumber
                    min={500}
                    max={20000}
                    step={500}
                    value={targetWords}
                    onChange={(value) => setTargetWords(Number(value || 3000))}
                    className="story-stage-control"
                  />
                </Col>
              ) : null}
            </Row>

            {activeStage === "body" ? (
              <div className="story-body-target">
                <Text type="secondary">目标章节</Text>
                <Select
                  value={targetChapterId ?? undefined}
                  options={chapterOptions}
                  placeholder="请先创建章节草稿"
                  onChange={(value) => setTargetChapterId(value)}
                  className="story-stage-control"
                />
              </div>
            ) : null}

            <TextArea
              value={drafts[activeStage]}
              onChange={(event) => updateDraft(activeStage, event.target.value)}
              rows={activeStage === "body" ? 18 : 15}
              placeholder={stage.placeholder}
              className="story-stage-editor"
            />

            <div className="story-stage-actions">
              <Space wrap>
                <Tooltip title="需要配置 API Key 后才能真正调用模型。未配置时可以手写或粘贴草稿。">
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={generating === activeStage}
                    disabled={generating !== null || saving !== null}
                    onClick={() => void runAiStage(activeStage)}
                  >
                    AI 生成草稿
                  </Button>
                </Tooltip>
                <Button
                  icon={<CheckCircleOutlined />}
                  loading={saving === activeStage}
                  disabled={generating !== null || saving !== null}
                  onClick={() => void saveAccepted(activeStage)}
                >
                  {activeStage === "body" ? "保存正文到章节" : "保存采纳"}
                </Button>
                <Button icon={<CopyOutlined />} onClick={() => copyPrompt(activeStage)}>
                  复制上下文提示词
                </Button>
                <Button onClick={() => updateDraft(activeStage, "")}>清空草稿</Button>
              </Space>
              <Text type="secondary" className="story-stage-autosave-note">
                草稿已自动保存在本机；只有点击“保存采纳”后，才会被后续模块引用。
              </Text>
              <Space wrap>
                {activeStage === "character" ? (
                  <Button loading={saving === "character"} onClick={() => void createCharacterRecords()}>
                    用{activeFlowName}生成人物记录
                  </Button>
                ) : null}
                {activeStage === "volume" ? (
                  <Button loading={saving === "volume"} onClick={() => void createVolumeDrafts()}>
                    用{activeFlowName}生成卷目录
                  </Button>
                ) : null}
                {activeStage === "chapter" ? (
                  <Button loading={saving === "chapter"} onClick={() => void createChapterDrafts()}>
                    用{activeFlowName}生成章节草稿
                  </Button>
                ) : null}
              </Space>
            </div>
          </Card>
        </main>

        <aside className="story-context-panel">
          <Card title={`${activeFlowName}后续会引用的已采纳内容`} className="story-context-card">
            <Space direction="vertical" size="middle" className="story-context-list">
              {STAGES.filter((item) => item.key !== "body").map((item) => (
                <div key={item.key} className="story-context-item">
                  <div className="story-context-item__head">
                    <strong>{item.shortTitle}</strong>
                    <Tag color={completed[item.key] ? "green" : "default"}>{completed[item.key] ? "已采纳" : "空"}</Tag>
                  </div>
                  <p>{previewText(
                    item.key === "character" ? acceptedContext.characters
                      : item.key === "book" ? acceptedContext.book_outline
                        : item.key === "volume" ? acceptedContext.volume_outline
                          : item.key === "chapter" ? acceptedContext.chapter_outline
                            : item.key === "planner" ? acceptedContext.planner_notes
                              : accepted[item.key]
                  )}</p>
                </div>
              ))}
            </Space>
          </Card>
          <Card title="作品级章节状态" className="story-context-card">
            {chapters.length ? (
              <Space direction="vertical" className="story-context-list">
                {chapters.slice(0, 6).map((chapter, index) => (
                  <div key={chapter.id} className="story-chapter-mini">
                    <strong>{index + 1}. {chapter.title || "未命名章节"}</strong>
                    <Tag color={chapter.content.trim() ? "green" : "default"}>{chapter.content.trim() ? "有正文" : "待写"}</Tag>
                  </div>
                ))}
                {chapters.length > 6 ? <Text type="secondary">还有 {chapters.length - 6} 章，进入写作页查看。</Text> : null}
              </Space>
            ) : (
              <Empty description="还没有章节草稿" />
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

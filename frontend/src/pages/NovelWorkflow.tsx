import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
  message,
} from "antd";
import {
  BranchesOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createChapter,
  createMemo,
  fetchChapters,
  fetchLlmProviders,
  fetchMemos,
  fetchNovel,
  generateWorkflowStage,
  updateChapter,
  updateMemo,
} from "@/api/client";
import type { BuiltinProviderInfo, Chapter, Memo, Novel } from "@/types";

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

type StageKey = "global" | "volume" | "chapter" | "body";

type StageModelConfig = {
  provider: string;
  model: string;
};

type StageConfigMap = Record<StageKey, StageModelConfig>;

const MEMO_TITLES: Record<"global" | "volume", string> = {
  global: "【AI创作流程】故事总纲",
  volume: "【AI创作流程】分卷大纲",
};

const DEFAULT_STAGE_CONFIG: StageConfigMap = {
  global: { provider: "deepseek", model: "deepseek-v4-flash" },
  volume: { provider: "deepseek", model: "deepseek-v4-flash" },
  chapter: { provider: "qwen", model: "qwen-plus" },
  body: { provider: "qwen", model: "qwen-plus" },
};

const STAGE_COPY: Array<{
  key: StageKey;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    key: "global",
    title: "故事总纲",
    description: "确定题材、卖点、主线、人物关系和结局方向。",
    icon: <BranchesOutlined />,
  },
  {
    key: "volume",
    title: "分卷大纲",
    description: "把总纲拆成第一卷、第二卷等阶段目标。",
    icon: <FolderOpenOutlined />,
  },
  {
    key: "chapter",
    title: "章节大纲",
    description: "把卷纲拆成第一章、第二章等可写摘要。",
    icon: <FileTextOutlined />,
  },
  {
    key: "body",
    title: "正文生成",
    description: "进入写作页，根据章节摘要生成或手写正文。",
    icon: <EditOutlined />,
  },
];

function makeStorageKey(novelId: number) {
  return `inkmind.workflow.stage-models.${novelId}`;
}

function findMemoByTitle(memos: Memo[], title: string) {
  return memos.find((memo) => memo.title.trim() === title);
}

function parseChapterPlan(raw: string) {
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      const first = lines[0] ?? "";
      const titleMatch = first.match(/^(?:第[一二三四五六七八九十百千万0-9]+章[：:\s、.-]*)?(.+)$/);
      const title = (titleMatch?.[1] || first || `第${index + 1}章`).slice(0, 80);
      const summary = lines.length > 1 ? lines.slice(1).join("\n") : block;
      return { title, summary };
    });
}

export default function NovelWorkflow() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [providers, setProviders] = useState<BuiltinProviderInfo[]>([]);
  const [models, setModels] = useState<StageConfigMap>(DEFAULT_STAGE_CONFIG);
  const [globalOutline, setGlobalOutline] = useState("");
  const [volumeOutline, setVolumeOutline] = useState("");
  const [chapterOutline, setChapterOutline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<StageKey | null>(null);
  const [generating, setGenerating] = useState<StageKey | null>(null);
  const [err, setErr] = useState("");

  const globalMemo = useMemo(() => findMemoByTitle(memos, MEMO_TITLES.global), [memos]);
  const volumeMemo = useMemo(() => findMemoByTitle(memos, MEMO_TITLES.volume), [memos]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const saved = window.localStorage.getItem(makeStorageKey(id));
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
    (async () => {
      try {
        const [novelData, memoList, chapterList, providerData] = await Promise.all([
          fetchNovel(id),
          fetchMemos(id),
          fetchChapters(id),
          fetchLlmProviders(),
        ]);
        setNovel(novelData);
        setMemos(memoList);
        setChapters(chapterList);
        setProviders(providerData.builtin);
        setGlobalOutline(findMemoByTitle(memoList, MEMO_TITLES.global)?.body || novelData.background || "");
        setVolumeOutline(findMemoByTitle(memoList, MEMO_TITLES.volume)?.body || "");
        setChapterOutline(
          chapterList
            .map((chapter, index) => `${index + 1}. ${chapter.title || `第${index + 1}章`}\n${chapter.summary || ""}`)
            .join("\n\n")
        );
      } catch (e) {
        setErr(apiErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function providerOptions() {
    const fromApi = providers.map((provider) => ({
      label: provider.label,
      value: provider.id,
    }));
    const fallback = [
      { label: "DeepSeek", value: "deepseek" },
      { label: "Qwen / 通义千问", value: "qwen" },
      { label: "Google Gemini", value: "gemini" },
      { label: "OpenAI", value: "openai" },
    ];
    return fromApi.length ? fromApi : fallback;
  }

  function modelOptions(stage: StageKey) {
    const provider = providers.find((item) => item.id === models[stage].provider);
    const knownModels = provider?.models ?? [];
    const current = models[stage].model;
    return Array.from(new Set([current, ...knownModels].filter(Boolean))).map((model) => ({
      label: model,
      value: model,
    }));
  }

  function updateStageModel(stage: StageKey, patch: Partial<StageModelConfig>) {
    setModels((prev) => {
      const next = {
        ...prev,
        [stage]: {
          ...prev[stage],
          ...patch,
        },
      };
      window.localStorage.setItem(makeStorageKey(id), JSON.stringify(next));
      return next;
    });
  }

  async function upsertMemo(stage: "global" | "volume", body: string) {
    setSaving(stage);
    try {
      const existing = stage === "global" ? globalMemo : volumeMemo;
      const title = MEMO_TITLES[stage];
      const saved = existing
        ? await updateMemo(id, existing.id, { title, body })
        : await createMemo(id, { title, body });
      setMemos((prev) => {
        const withoutOld = prev.filter((memo) => memo.id !== saved.id);
        return [saved, ...withoutOld];
      });
      message.success(`${stage === "global" ? "故事总纲" : "分卷大纲"}已保存`);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  async function createChapterDrafts() {
    const plans = parseChapterPlan(chapterOutline);
    if (!plans.length) {
      message.warning("请先填写章节大纲");
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
      message.success(`已创建 ${created.length} 个章节草稿`);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  async function runAiStage(stage: StageKey) {
    const config = models[stage];
    const targetChapter = chapters.find((chapter) => !chapter.content.trim()) || chapters[0] || null;
    if (stage === "volume" && !globalOutline.trim()) {
      message.warning("请先生成或填写故事总纲");
      return;
    }
    if (stage === "chapter" && !volumeOutline.trim()) {
      message.warning("请先生成或填写分卷大纲");
      return;
    }
    if (stage === "body" && !targetChapter) {
      message.warning("请先在章节大纲阶段创建章节草稿");
      return;
    }

    setErr("");
    setGenerating(stage);
    let streamed = "";
    const applyText = (text: string) => {
      if (stage === "global") setGlobalOutline(text);
      if (stage === "volume") setVolumeOutline(text);
      if (stage === "chapter") setChapterOutline(text);
    };
    if (stage !== "body") applyText("");
    try {
      const result = await generateWorkflowStage(
        id,
        {
          stage,
          provider: config.provider,
          model: config.model,
          global_outline: globalOutline,
          volume_outline: volumeOutline,
          chapter_outline: chapterOutline,
          target_chapter_id: targetChapter?.id ?? null,
        },
        (chunk) => {
          streamed += chunk;
          if (stage !== "body") applyText(streamed);
        }
      );
      const finalText = result.text || streamed;
      if (stage === "global") setGlobalOutline(finalText);
      if (stage === "volume") setVolumeOutline(finalText);
      if (stage === "chapter") setChapterOutline(finalText);
      if (stage === "body" && targetChapter) {
        const updated = await updateChapter(id, targetChapter.id, {
          content: finalText,
          skip_version: true,
        });
        setChapters((prev) => prev.map((chapter) => chapter.id === updated.id ? updated : chapter));
      }
      message.success(stage === "body" ? "正文已生成到章节草稿" : "AI 已生成并填入");
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("AI 生成失败");
    } finally {
      setGenerating(null);
    }
  }

  function copyPrompt(stage: StageKey) {
    const config = models[stage];
    const promptMap: Record<StageKey, string> = {
      global: `请根据下面的作品设定，生成一份可执行的长篇小说故事总纲。要求包含核心卖点、主线冲突、主要人物、世界观、分卷方向和结局。\n\n作品：${novel?.title || ""}\n类型：${novel?.genre || ""}\n文风：${novel?.writing_style || ""}\n背景：${novel?.background || ""}`,
      volume: `请基于故事总纲拆分分卷大纲。每卷包含卷名、阶段目标、主要冲突、人物变化、关键爽点和结尾钩子。\n\n故事总纲：\n${globalOutline}`,
      chapter: `请基于分卷大纲拆成章节大纲。每章格式为：章节标题换行，2-4句章节摘要。不要写正文。\n\n分卷大纲：\n${volumeOutline}`,
      body: `请基于章节摘要生成正文。保持人物行为一致，避免复述前文，直接推进新剧情。\n\n章节摘要：\n${chapterOutline}`,
    };
    void navigator.clipboard.writeText(`[推荐模型：${config.provider} / ${config.model}]\n\n${promptMap[stage]}`);
    message.success("提示词已复制，可粘贴到 AI 助手或外部模型中");
  }

  if (loading) {
    return (
      <div style={{ padding: "4rem", textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: "0.5rem" }}>
      {err ? (
        <Alert
          message="操作失败"
          description={err}
          type="error"
          showIcon
          closable
          onClose={() => setErr("")}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card
        style={{ borderRadius: 18, marginBottom: 16 }}
        title={
          <Space>
            <ThunderboltOutlined style={{ color: "var(--accent)" }} />
            <span>AI 小说创作流程</span>
            {novel?.title ? <Tag color="blue">{novel.title}</Tag> : null}
          </Space>
        }
        extra={<Link to={`/novels/${id}/write`}><Button type="primary">进入正文写作</Button></Link>}
      >
        <Paragraph type="secondary" style={{ marginBottom: 20 }}>
          这里按你的流程把长篇小说拆成四步。每一步都可以先选模型，再保存阶段产物。
          当前版本先复用现有数据结构：总纲和卷纲保存为构思笔记，章节大纲创建为章节草稿，正文到写作页生成。
        </Paragraph>
        <Steps
          current={chapters.some((chapter) => chapter.content.trim()) ? 3 : chapters.length ? 2 : volumeOutline ? 1 : globalOutline ? 0 : 0}
          items={STAGE_COPY.map((stage) => ({
            title: stage.title,
            description: stage.description,
            icon: stage.icon,
          }))}
        />
      </Card>

      <Row gutter={[16, 16]}>
        {STAGE_COPY.map((stage) => (
          <Col xs={24} lg={12} key={stage.key}>
            <Card
              title={
                <Space>
                  {stage.icon}
                  <span>{stage.title}</span>
                  {stage.key === "global" && globalMemo ? <Tag color="green">已保存</Tag> : null}
                  {stage.key === "volume" && volumeMemo ? <Tag color="green">已保存</Tag> : null}
                  {stage.key === "chapter" && chapters.length ? <Tag color="green">{chapters.length} 章</Tag> : null}
                  {stage.key === "body" && chapters.some((chapter) => chapter.content.trim()) ? <Tag color="green">已有正文</Tag> : null}
                </Space>
              }
              extra={<Button size="small" onClick={() => copyPrompt(stage.key)}>复制提示词</Button>}
              style={{ borderRadius: 16, height: "100%" }}
            >
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Row gutter={8}>
                  <Col span={10}>
                    <Text type="secondary">模型商</Text>
                    <Select
                      value={models[stage.key].provider}
                      options={providerOptions()}
                      onChange={(provider) => updateStageModel(stage.key, {
                        provider,
                        model: providers.find((item) => item.id === provider)?.default_model || models[stage.key].model,
                      })}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                  <Col span={14}>
                    <Text type="secondary">模型</Text>
                    <Select
                      value={models[stage.key].model}
                      options={modelOptions(stage.key)}
                      onChange={(model) => updateStageModel(stage.key, { model })}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                </Row>

                {stage.key === "global" ? (
                  <>
                    <TextArea
                      rows={12}
                      value={globalOutline}
                      onChange={(event) => setGlobalOutline(event.target.value)}
                      placeholder="在这里写或粘贴故事总纲：题材、主线、人物、世界观、结局方向..."
                    />
                    <Space wrap>
                      <Button
                        icon={<ThunderboltOutlined />}
                        loading={generating === "global"}
                        disabled={generating !== null || saving !== null}
                        onClick={() => void runAiStage("global")}
                      >
                        AI生成并填入
                      </Button>
                      <Button
                        type="primary"
                        loading={saving === "global"}
                        onClick={() => upsertMemo("global", globalOutline)}
                      >
                        保存故事总纲
                      </Button>
                    </Space>
                  </>
                ) : null}

                {stage.key === "volume" ? (
                  <>
                    <TextArea
                      rows={12}
                      value={volumeOutline}
                      onChange={(event) => setVolumeOutline(event.target.value)}
                      placeholder="在这里写或粘贴分卷大纲：第一卷、第二卷、每卷目标和钩子..."
                    />
                    <Space wrap>
                      <Button
                        icon={<ThunderboltOutlined />}
                        loading={generating === "volume"}
                        disabled={generating !== null || saving !== null}
                        onClick={() => void runAiStage("volume")}
                      >
                        AI生成并填入
                      </Button>
                      <Button
                        type="primary"
                        loading={saving === "volume"}
                        onClick={() => upsertMemo("volume", volumeOutline)}
                      >
                        保存分卷大纲
                      </Button>
                    </Space>
                  </>
                ) : null}

                {stage.key === "chapter" ? (
                  <>
                    <TextArea
                      rows={12}
                      value={chapterOutline}
                      onChange={(event) => setChapterOutline(event.target.value)}
                      placeholder={"每章用空行分隔，例如：\n第一章 归来\n主角回到故乡，发现旧案线索。\n\n第二章 暗潮\n反派势力开始试探，主角被迫出手。"}
                    />
                    <Space wrap>
                      <Button
                        icon={<ThunderboltOutlined />}
                        loading={generating === "chapter"}
                        disabled={generating !== null || saving !== null}
                        onClick={() => void runAiStage("chapter")}
                      >
                        AI生成并填入
                      </Button>
                      <Button
                        type="primary"
                        loading={saving === "chapter"}
                        onClick={() => void createChapterDrafts()}
                      >
                        生成章节草稿
                      </Button>
                    </Space>
                  </>
                ) : null}

                {stage.key === "body" ? (
                  <div>
                    {chapters.length ? (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        {chapters.slice(0, 6).map((chapter, index) => (
                          <Card size="small" key={chapter.id}>
                            <Space direction="vertical" size={2}>
                              <Text strong>{index + 1}. {chapter.title || "未命名章节"}</Text>
                              <Text type="secondary">{chapter.summary || "暂无章节摘要"}</Text>
                              {chapter.content.trim() ? <Tag color="green">已有正文</Tag> : <Tag>待生成正文</Tag>}
                            </Space>
                          </Card>
                        ))}
                        {chapters.length > 6 ? <Text type="secondary">还有 {chapters.length - 6} 章，进入写作页查看。</Text> : null}
                        <Link to={`/novels/${id}/write`}>
                          <Button type="primary" icon={<CheckCircleOutlined />}>去写作页生成正文</Button>
                        </Link>
                        <Button
                          icon={<ThunderboltOutlined />}
                          loading={generating === "body"}
                          disabled={generating !== null || saving !== null}
                          onClick={() => void runAiStage("body")}
                        >
                          AI生成到第一个待写章节
                        </Button>
                      </Space>
                    ) : (
                      <Empty description="先在章节大纲阶段创建章节草稿" />
                    )}
                  </div>
                ) : null}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Divider />
      <Alert
        type="info"
        showIcon
        message="当前实现说明"
        description="模型 API 已接入：总纲、卷纲、章纲会按当前阶段选择的 provider/model 生成并填入；正文阶段会生成到第一个待写正文的章节。"
      />
    </div>
  );
}

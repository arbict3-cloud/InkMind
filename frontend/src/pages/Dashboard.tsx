import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Layout,
  Card,
  Typography,
  Button,
  Space,
  List,
  Empty,
  Spin,
  Alert,
  Tag,
  Tooltip,
  message,
  Modal,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ExportOutlined,
  DeleteOutlined,
  BookOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import ExportNovelModal from "@/components/ExportNovelModal";
import { QuotaWarning } from "@/components/QuotaWarning";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import type { Novel } from "@/types";
import { isNovelSetupComplete, novelPrimaryHref } from "@/utils/novelSetup";

const { Content } = Layout;
const { Title, Text } = Typography;
const { confirm } = Modal;

export default function Dashboard() {
  const { logout } = useAuth();
  const { t } = useI18n();
  const colors = useHeaderTheme();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      const list = await fetchNovels();
      setNovels(list);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate() {
    setCreating(true);
    try {
      const n = await createNovel({ title: t("dashboard_untitled") });
      setNovels((prev) => [n, ...prev]);
      message.success(t("create_novel_success"));
      nav(novelPrimaryHref(n));
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error(t("dashboard_create_failed"));
    } finally {
      setCreating(false);
    }
  }

  function showDeleteConfirm(novel: Novel) {
    confirm({
      title: t("dashboard_delete_confirm_title"),
      content: t("dashboard_delete_confirm_content").replace("{title}", novel.title || t("dashboard_untitled")),
      okText: t("dashboard_yes_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteNovel(novel.id);
          setNovels((prev) => prev.filter((x) => x.id !== novel.id));
          message.success(t("dashboard_delete_success"));
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error(t("dashboard_delete_failed"));
        }
      },
    });
  }

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;
  const textColor = colors.textColor;
  const cardBg = colors.cardBg;
  const secondaryTextColor = colors.secondaryTextColor;

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <AppHeader
        leftContent={
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <BookOutlined style={{ fontSize: "1.75rem", color: colors.primaryColor }} />
            <Title level={3} style={{
              margin: 0,
              fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              color: textColor,
              fontSize: "1.35rem",
              transition: "color 0.3s ease",
            }}>
              {t("app_name")}
            </Title>
          </div>
        }
        extraActions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onCreate}
            loading={creating}
            size="large"
            style={{ height: 40, paddingLeft: 20, paddingRight: 20 }}
          >
            {t("dashboard_create_novel")}
          </Button>
        }
        onLogout={() => {
          logout();
          message.success(t("dashboard_logged_out"));
        }}
      />

      <Content
        style={{
          padding: "2rem",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {err && (
          <Alert
            message={t("operation_failed_title")}
            description={err}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <QuotaWarning />

        <Spin spinning={loading}>
          {novels.length === 0 ? (
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: colors.isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Empty
                description={
                  <div>
                    <Title level={4} style={{ marginBottom: "0.5rem", color: textColor }}>
                      {t("dashboard_no_novels")}
                    </Title>
                    <Text type="secondary">
                      {t("dashboard_no_novels_desc")}
                    </Text>
                  </div>
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          ) : (
            <div>
              <Title
                level={4}
                style={{
                  marginBottom: "1rem",
                  fontFamily: '"Source Sans 3", system-ui, sans-serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                {t("dashboard_title")} ({novels.length})
              </Title>

              <List
                grid={{
                  gutter: [24, 24],
                  xs: 1,
                  sm: 1,
                  md: 2,
                  lg: 2,
                  xl: 2,
                }}
                dataSource={novels}
                renderItem={(novel) => {
                  const entry = novelPrimaryHref(novel);
                  const ready = isNovelSetupComplete(novel);

                  return (
                    <List.Item>
                      <Card
                        hoverable
                        style={{
                          borderRadius: 16,
                          border: "none",
                          boxShadow: colors.isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                          background: cardBg,
                          transition: "all 0.3s",
                        }}
                        bodyStyle={{ padding: "1.5rem" }}
                        actions={[
                          <Tooltip title={ready ? t("nav_write") : t("nav_settings")} key="edit">
                            <Link to={entry}>
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                style={{ color: "#cc785c" }}
                              >
                                {ready ? t("dashboard_write") : t("dashboard_setup")}
                              </Button>
                            </Link>
                          </Tooltip>,
                          <Tooltip title={t("dashboard_export_novel")} key="export">
                            <Button
                              type="text"
                              icon={<ExportOutlined />}
                              onClick={() => setExportNovel(novel)}
                              style={{ color: "#cc785c" }}
                            >
                              {t("dashboard_export_novel")}
                            </Button>
                          </Tooltip>,
                          <Tooltip title={t("dashboard_delete_novel")} key="delete">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => showDeleteConfirm(novel)}
                            >
                              {t("dashboard_delete_novel")}
                            </Button>
                          </Tooltip>,
                        ]}
                      >
                        <Card.Meta
                          title={
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: "0.25rem",
                              }}
                            >
                              <Link
                                to={entry}
                                style={{
                                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                                  fontSize: "1.15rem",
                                  fontWeight: 600,
                                  color: textColor,
                                  textDecoration: "none",
                                  transition: "color 0.3s ease",
                                }}
                              >
                                {novel.title || t("dashboard_untitled")}
                              </Link>
                              {!ready && (
                                <Tag color="orange" icon={<QuestionCircleOutlined />}>
                                  {t("dashboard_incomplete")}
                                </Tag>
                              )}
                            </div>
                          }
                          description={
                            <div>
                              <div
                                style={{
                                  marginBottom: "0.5rem",
                                }}
                              >
                                <Space size="middle">
                                  <Text type="secondary" style={{ fontSize: "0.85rem", color: secondaryTextColor }}>
                                    {novel.genre ? t("dashboard_genre") + novel.genre : t("dashboard_no_genre")}
                                  </Text>
                                </Space>
                              </div>
                              <Text
                                type="secondary"
                                style={{
                                  fontSize: "0.8rem",
                                  color: secondaryTextColor,
                                  transition: "color 0.3s ease",
                                }}
                              >
                                {t("dashboard_created")}{new Date(novel.updated_at).toLocaleString()}
                              </Text>
                            </div>
                          }
                        />
                      </Card>
                    </List.Item>
                  );
                }}
              />
            </div>
          )}
        </Spin>
      </Content>

      {exportNovel && (
        <ExportNovelModal novel={exportNovel} onClose={() => setExportNovel(null)} />
      )}
    </Layout>
  );
}

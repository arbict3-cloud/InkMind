import { useEffect, useState } from "react";
import {
  Layout,
  Card,
  Form,
  InputNumber,
  Button,
  Alert,
  Typography,
  Space,
  message,
  Row,
  Col,
  Select,
  Switch,
} from "antd";
import {
  SaveOutlined,
  ArrowLeftOutlined,
  SettingOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  SafetyOutlined,
  EyeOutlined,
  GoldOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import { useAuth } from "@/context/AuthContext";
import { useNavigation } from "@/context/NavigationContext";
import { useI18n } from "@/i18n";

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

type AgentMode = "flexible" | "react" | "direct";

export default function AiSettings() {
  const { user, updateAiSettings } = useAuth();
  const { t } = useI18n();
  const colors = useHeaderTheme();
  const { goBackSmart } = useNavigation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const getAgentModeLabel = (mode: AgentMode): string => {
    const map: Record<AgentMode, string> = {
      flexible: "ai_settings_flexible",
      react: "ai_settings_react",
      direct: "ai_settings_direct",
    };
    return t(map[mode]);
  };

  const getAgentModeDescription = (mode: AgentMode): string => {
    const map: Record<AgentMode, string> = {
      flexible: "ai_settings_flexible_desc",
      react: "ai_settings_react_desc",
      direct: "ai_settings_direct_desc",
    };
    return t(map[mode]);
  };

  useEffect(() => {
    if (!user) return;
    form.setFieldsValue({
      agent_mode: user.agent_mode || "flexible",
      max_llm_iterations: user.max_llm_iterations || 10,
      max_tokens_per_task: user.max_tokens_per_task || 50000,
      enable_auto_audit: user.enable_auto_audit ?? true,
      preview_before_save: user.preview_before_save ?? true,
      auto_audit_min_score: user.auto_audit_min_score || 60,
      ai_language: user.ai_language || null,
    });
  }, [user, form]);

  const onFinish = async (values: {
    agent_mode: string;
    max_llm_iterations: number;
    max_tokens_per_task: number;
    enable_auto_audit: boolean;
    preview_before_save: boolean;
    auto_audit_min_score: number;
    ai_language: string | null;
  }) => {
    setErrorMsg("");
    setSuccessMsg("");
    setSaving(true);
    try {
      await updateAiSettings({
        agent_mode: values.agent_mode,
        max_llm_iterations: values.max_llm_iterations,
        max_tokens_per_task: values.max_tokens_per_task,
        enable_auto_audit: values.enable_auto_audit,
        preview_before_save: values.preview_before_save,
        auto_audit_min_score: values.auto_audit_min_score,
        ai_language: values.ai_language,
      });
      message.success(t("ai_settings_save_success"));
      setSuccessMsg(t("ai_settings_save_success"));
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setErrorMsg(String(e) || t("ai_settings_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;
  const textColor = colors.textColor;
  const cardBg = colors.cardBg;
  const secondaryTextColor = colors.secondaryTextColor;

  const innerCardBg = colors.isDark
    ? "linear-gradient(180deg, #1e1d1b 0%, #181715 100%)"
    : "linear-gradient(180deg, #faf9f5 0%, #f5f0e8 100%)";

  const primaryColor = colors.primaryColor;

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
            <SettingOutlined style={{ fontSize: "1.75rem", color: primaryColor }} />
            <Title level={3} style={{
              margin: 0,
              fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              color: textColor,
              fontSize: "1.35rem",
              transition: "color 0.3s ease",
            }}>
              {t("ai_settings_title")}
            </Title>
          </div>
        }
        extraActions={
          <Button icon={<ArrowLeftOutlined />} onClick={() => goBackSmart()} size="large" style={{ height: 40 }}>
            {t("nav_back")}
          </Button>
        }
        disabledMenuItem="settings"
      />

      <Content
        style={{
          padding: "2rem",
          maxWidth: 900,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {successMsg && (
          <Alert
            message={t("ai_settings_save_success")}
            description={successMsg}
            type="success"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        {errorMsg && (
          <Alert
            message={t("ai_settings_save_failed")}
            description={errorMsg}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <Card
          style={{
            borderRadius: 16,
            border: "none",
            boxShadow: colors.isDark
              ? "0 4px 6px rgba(0, 0, 0, 0.3)"
              : "0 4px 6px rgba(28, 25, 23, 0.06)",
            background: cardBg,
            transition: "background-color 0.3s ease, box-shadow 0.3s ease",
          }}
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <SettingOutlined
                style={{ color: primaryColor, fontSize: "1.25rem" }}
              />
              <Title
                level={4}
                style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                }}
              >
                {t("ai_settings_title")}
              </Title>
            </div>
          }
          extra={
            <Text type="secondary" style={{ color: secondaryTextColor }}>
              {t("ai_settings_subtitle")}
            </Text>
          }
        >
          <Form
            form={form}
            name="aiSettings"
            onFinish={onFinish}
            layout="vertical"
            initialValues={{
              agent_mode: "flexible",
              max_llm_iterations: 10,
              max_tokens_per_task: 50000,
              enable_auto_audit: true,
              preview_before_save: true,
              auto_audit_min_score: 60,
            }}
          >
            <Card
              type="inner"
              title={
                <Space>
                  <RobotOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_agent_mode")}</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Form.Item
                name="agent_mode"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_select_mode")}
                  </Text>
                }
              >
                <Select size="large" style={{ width: "100%" }}>
                  {(["flexible", "react", "direct"] as AgentMode[]).map((mode) => (
                    <Option key={mode} value={mode}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Text strong style={{ color: textColor }}>
                          {getAgentModeLabel(mode)}
                        </Text>
                        <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                          {getAgentModeDescription(mode)}
                        </Text>
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Alert
                message={t("ai_settings_mode_note_title")}
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    {t("ai_settings_mode_note")}
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<RobotOutlined />}
                style={{ marginTop: "1rem" }}
              />
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <GoldOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_resource_limit")}</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_llm_iterations"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_max_iterations")}
                      </Text>
                    }
                    rules={[{ type: "number", min: 1, max: 50, message: t("validation_number_range").replace("{min}", "1").replace("{max}", "50") }]}
                  >
                    <InputNumber
                      min={1}
                      max={50}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter={t("common_rounds")}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    {t("ai_settings_max_iterations_desc")}
                  </Text>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="max_tokens_per_task"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_max_tokens")}
                      </Text>
                    }
                    rules={[{ type: "number", min: 1000, max: 500000, message: t("validation_number_range").replace("{min}", "1000").replace("{max}", "500000") }]}
                  >
                    <InputNumber
                      min={1000}
                      max={500000}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter="tokens"
                      step={1000}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    {t("ai_settings_max_tokens_desc")}
                  </Text>
                </Col>
              </Row>
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <SafetyOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_quality_safety")}</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="enable_auto_audit"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_auto_audit")}
                      </Text>
                    }
                    valuePropName="checked"
                  >
                    <Switch
                      checkedChildren={<CheckCircleOutlined />}
                      unCheckedChildren={t("ai_settings_switch_off")}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    {t("ai_settings_auto_audit_desc")}
                  </Text>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="auto_audit_min_score"
                    label={
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_auto_audit_min_score")}
                      </Text>
                    }
                    dependencies={["enable_auto_audit"]}
                    rules={[{ type: "number", min: 0, max: 100, message: t("validation_number_range").replace("{min}", "0").replace("{max}", "100") }]}
                  >
                    <InputNumber
                      min={0}
                      max={100}
                      size="large"
                      style={{ width: "100%", height: 44 }}
                      addonAfter={t("common_points")}
                      disabled={!form.getFieldValue("enable_auto_audit")}
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                    {t("ai_settings_auto_audit_min_score_desc")}
                  </Text>
                </Col>
              </Row>
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <GlobalOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_ai_language")}</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Form.Item
                name="ai_language"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_ai_language")}
                  </Text>
                }
              >
                <Select size="large" style={{ width: "100%" }}>
                  <Option value={null}>
                    <Space>
                      <Text strong style={{ color: textColor }}>
                        {t("ai_settings_ai_language_follow_ui")}
                      </Text>
                    </Space>
                  </Option>
                  <Option value="zh">
                    <Space>
                      <Text strong style={{ color: textColor }}>
                        中文
                      </Text>
                    </Space>
                  </Option>
                  <Option value="en">
                    <Space>
                      <Text strong style={{ color: textColor }}>
                        English
                      </Text>
                    </Space>
                  </Option>
                </Select>
              </Form.Item>
              <Text type="secondary" style={{ fontSize: "0.8rem", color: secondaryTextColor }}>
                {t("ai_settings_ai_language_desc")}
              </Text>
            </Card>

            <Card
              type="inner"
              title={
                <Space>
                  <EyeOutlined style={{ color: primaryColor }} />
                  <span style={{ color: textColor }}>{t("ai_settings_preview_confirm")}</span>
                </Space>
              }
              style={{
                marginBottom: "1.5rem",
                background: innerCardBg,
                borderRadius: 12,
              }}
            >
              <Form.Item
                name="preview_before_save"
                label={
                  <Text strong style={{ color: textColor }}>
                    {t("ai_settings_preview_confirm")}
                  </Text>
                }
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<CheckCircleOutlined />}
                  unCheckedChildren={t("ai_settings_switch_off")}
                />
              </Form.Item>
              <Alert
                message={t("ai_settings_preview_confirm_recommended")}
                description={
                  <Paragraph style={{ margin: 0, color: secondaryTextColor }}>
                    {t("ai_settings_preview_confirm_note")}
                  </Paragraph>
                }
                type="info"
                showIcon
                icon={<EyeOutlined />}
              />
            </Card>

            <Form.Item style={{ marginBottom: 0, marginTop: "1rem" }}>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
                size="large"
                style={{
                  height: 44,
                  fontSize: "1rem",
                  fontWeight: 600,
                  paddingLeft: 32,
                  paddingRight: 32,
                }}
              >
                {t("ai_settings_save_button")}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Content>
    </Layout>
  );
}

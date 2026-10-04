---
name: "创作间"
description: "个人本地内容创作与多平台分发工作台；设计从当前实现提取。"
colors:
  primary: "#176b52"
  primary-hover: "#10513e"
  primary-soft: "#eaf5ef"
  ink: "#182538"
  muted: "#526277"
  sidebar: "#17212f"
  page: "#f4f6f9"
  surface: "#fff"
  border: "#dce3eb"
  input-border: "#bfcbd8"
  control-hover: "#eaf0f5"
  nav-muted: "#c5ceda"
  nav-hover: "#223244"
  nav-active: "#294239"
  nav-active-text: "#e6f6ed"
  danger: "#a62c31"
  danger-soft: "#fff1f1"
  warning: "#805316"
  warning-soft: "#fff7e7"
  badge-neutral: "#f5f7fa"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "-0.5px"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 550
  hint:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.45
  input:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  badge:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "5px"
  md: "8px"
  badge: "4px"
  navigation: "6px"
  compact-panel: "7px"
  dialog: "9px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "40px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "40px"
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.sm}"
    padding: "9px 11px"
  sidebar-navigation:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.nav-muted}"
    typography: "{typography.body}"
    width: "224px"
  status-badge:
    backgroundColor: "{colors.badge-neutral}"
    textColor: "{colors.muted}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  status-badge-success:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  status-badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
  status-badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  platform-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "12px 14px"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "min(660px, calc(100vw - 40px))"
---

# Design System: 创作间

## Overview

English is the default interface language. The header provides an English / 简体中文 selector whose choice persists in the browser. Longer English labels wrap within the existing responsive layout, dates follow the interface locale, and user-authored content keeps its original language. The English wordmark is “Creator Studio”; the Chinese wordmark remains “创作间”.

**Creative North Star: "清楚的个人创作桌面"**

“创作间”把写作、平台审阅和分发安排放在同一张桌面上。白色工作面承载正文，冷灰背景分隔工作区，深墨侧栏固定导航位置。绿色用于主要动作、选中状态和部分通过状态；正文与状态说明保持直接、清楚。

当前实现以紧凑列表、明确分区和按需展开的配置承载信息。它服务于个人反复编辑原稿、核对平台版本与检查任务结果的工作，不借视觉装饰增加额外步骤。这里的名称与“清楚、紧凑、克制”等风格描述均由实现提取，属于实现说明，不是用户原话，也不新增品牌承诺。

**Key Characteristics:**

- 正文与编辑控件优先，技术配置按需展开。
- 白色工作面、细边线和紧凑列表形成层级。
- 状态颜色始终配有文字，草稿、交接与正式发布分别表达。
- 桌面分栏，窄屏按任务顺序重排；长正文与列表可独立滚动。

提取依据：`PRODUCT.md`、`client/src/styles.css`、`client/src/management.css`、`client/src/platforms.css` 与 `client/src/ui.tsx`。前置 YAML 记录可复用值；局部控件的实际差异在以下说明中保留。

## Colors

主色是深绿，文字与中性色带有冷灰倾向。前置 token 是规范值，名称用于描述实际用途。

### Primary

- **工作绿**（primary）：主要动作、焦点、选中状态、通过状态与相关链接。
- **深工作绿**（primary-hover）：主按钮悬停。
- **浅绿工作面**（primary-soft）：审阅通过提示与部分已选中内容。

### Neutral

- **正文墨色**（ink）与**辅助灰蓝**（muted）：正文、标签、说明和时间记录。
- **侧栏深墨**（sidebar）：固定导航背景；nav-muted、nav-hover、nav-active 与 nav-active-text 保留其深色环境中的实际状态。
- **冷灰页面**（page）与**白色工作面**（surface）：页面底色与编辑、列表、配置容器。
- **细分隔线**（border）与**输入边线**（input-border）：容器边界与输入轮廓；局部列表仍有轻微边线差异，不将这些差异误写为全新的配色方案。
- **轻灰悬停**（control-hover）与**中性状态底色**（badge-neutral）：辅助操作、普通状态标签。

warning/warning-soft 表示待处理与提醒；danger/danger-soft 表示检查失败或错误。它们是反馈颜色，不是额外品牌主色。当前不同组件存在少量反馈边线与底色微差，新增组件优先复用公共状态组件。

sidecar 中的八级色带按现有色相生成，仅供设计面板预览；它们不是应用已实现的色阶，也不代表新增明暗主题。

**The Explicit State Rule.** 状态必须用准确文字表达；选中、参数齐全、凭据检查、浏览器交接、草稿与公开发布不能互相替代。

## Typography

全部界面使用系统无衬线字体栈，优先系统 UI 字体，并提供苹方、冬青黑体、微软雅黑等中文回退。当前没有独立展示字体或等宽品牌字体。

- **页面标题**：headline（26px、650、1.45），窄屏页面标题缩至 24px。
- **区块标题**：title（18px、600、1.5）；管理编辑区常用 16px，平台详情常用 17px，连续记录标题常用 14–15px。
- **正文**：body（14px、400、1.7）；管理页采用 1.55，阅读预览采用 15px、1.9，并限制在 72ch 内。
- **标签与按钮**：label/button（13px、550），按钮行高为 1.45。状态标签采用 badge（12px、400、1.4）。
- **辅助说明**：hint（12px、400、1.75）；各列表说明依上下文使用 1.5–1.8 的行高。
- **输入**：基础 input（14px、1.5）。创作台基础移动输入采用 16px；管理表单与平台筛选保留各自已实现的 14px/13px 密度。

中文标题不使用全大写、装饰性断行或额外展示字重；技术 ID 与时间使用同一字体栈，长值允许换行。

## Layout

桌面侧栏宽度为 224px，主区相应留出侧栏位置。顶部栏高 58px；正文容器居中，最大宽度 1480px，内边距为 30px 32px 52px。宽度到 1200px 时，侧栏缩为 204px，主区内边距缩为 26px 24px 42px。

写原稿采用正文与 336px 辅助栏，审阅采用 220px 版本列表与可伸缩编辑区。平台目录采用主列表与 320–380px 详情栏。管理页打开编辑器时采用可伸缩列表与 380px 表单；内容库与队列在桌面保留连续表格；720px 以下按条目呈现，每条记录保留审阅、状态、时间和操作标签，避免页面横向溢出。

- **到 1160px**：管理页表单转到列表前方，取消粘性侧栏；平台与连接方式选择可使用两列。
- **到 1050px**：创作与分发转为单列；平台目录详情改为按需对话框；审阅版本栏缩窄。
- **到 760px**：导航成为可展开侧栏，宽 244px；顶部栏为 56px，页面内边距为 22px 16px 36px；审阅版本切换改为下拉框，主按钮与主要输入最小高度为 44px。
- **到 720px**：管理页工具栏换行，搜索占整行；表单与记录内边距收至 16–18px。表格转为逐条标签和值，输入控件使用 16px 字号。
- **到 430px**：管理页平台与方式选择变为一列。到 360px，创作步骤隐藏图标并保留文字。

间距 token 使用 8、16、24、32px；组件内还保留已实现的 7、12、18、20、22px 间隔。它们是按信息密度建立的实际节奏，当前没有强制所有距离落到单一网格。

## Elevation & Depth

常驻工作面主要用白色底、细边线、浅色选中行与深色侧栏形成层级。普通面板没有投影。阴影只出现在需要浮起的菜单、对话框和小型切换状态中。

- **对话框**（`0 18px 60px #0a142b33`）：覆盖页面的原生 dialog。
- **导出菜单**（`0 4px 18px #17212f14`）：临时浮层。
- **分段选中状态**（`0 1px 2px #17212f14`）：小范围突出当前切换项。
- **选中版本/平台行**：用内嵌标记或浅色轮廓，不产生抬起的卡片效果。

按钮颜色变化为 0.15s；管理展开箭头为 0.16s；移动侧栏为 0.18s。加载图标按 1s 旋转。减少动画偏好会关闭过渡与动画，动效不承载唯一的状态信息。

## Shapes

整体采用小圆角和清楚的边框。基础按钮与输入为 sm（5px），公共面板为 md（8px），状态标签为 4px，导航为 6px；部分管理/目录容器为 7px，对话框为 9px。圆形主要用于步骤编号、执行图标和状态点。

输入使用白底与细边线，正文编辑区保持较大可伸缩文本面。图标按钮桌面为 36px 方形，基础移动图标按钮为 40px；平台标签删除控件在移动端为 38px，不能把所有小型辅助控件误记成统一的 44px。

## Components

### Buttons

主要按钮用工作绿、白字和小圆角，基础高度至少 40px，内边距 9px 14px；移动主要按钮至少 44px。普通按钮白底有边框；quiet 用透明背景和辅助文字；danger 用错误文字与弱红边线。

悬停改变底色/边线，键盘焦点显示 2px 可见轮廓。Button 默认 `type="button"`，表单提交显式使用 `type="submit"`；busy 会显示执行图标、设置 aria-busy 并禁用按钮，disabled 不冒充执行成功。

### Inputs / Fields

标签位于输入上方，说明位于输入下方。普通输入的内边距是 9px 11px，基础最小高度 40px，焦点改变边线并保留可见轮廓。多行正文可垂直调整尺寸；账号凭据使用隐藏输入，已保存凭据留空保留，并按需展示说明。折叠辅助参数不清空已输入值。

### Chips / Status badges

公共状态标签使用紧凑文字、4px 圆角、3px 7px 内边距。中性、通过、待处理、失败四种状态均以文字说明实际含义。平台路径标签进一步区分官方接口、外部服务、浏览器辅助与导出；“参数齐全”只描述配置。

### Cards / Containers

公共容器是白底、8px 圆角、1px 边线的平面面板；标题区通常为 18px 22px 内边距，移动为 16px。列表用连续行和分隔线，设置用按主题分区；原稿、审阅、账号配置的容器密度随任务变化，不一律做成相同卡片。

### Navigation

深墨侧栏以分组文字与 44px 导航行组织页面；悬停略提亮，当前项使用深绿底和浅绿文字，焦点使用浅绿轮廓。小屏以明确菜单按钮展开，关闭时侧栏不可聚焦；导航和关闭操作受到未保存保护。

### Platform rows and version lists

平台目录采用可搜索主列表与当前平台详情，行内先显示身份，再显示分发方式和账号状态。桌面平台行至少 72px 高；详情窄屏打开为对话框。审阅版本列表用浅绿底与内嵌绿色标记表达当前项，不表示该版本已公开发布。

### Dialogs and snapshots

Modal 使用原生 dialog 的 showModal；保存并恢复此前焦点，支持 Escape 与关闭按钮，限制对话框内键盘导航，背景不参与交互。基础宽度是 `min(660px, calc(100vw - 40px))`，最大高度为 `calc(100dvh - 48px)`，允许内容滚动。平台选择对话框使用更宽的专用布局。任务快照保留原有正文、分段和素材信息；人工确认默认不选择结果，重试先呈现原快照与重复发送提醒。

## Do's and Don'ts

### Do:

- Do 沿用前置 token 和系统中文字体，正文、标签与辅助说明保持清楚的层级。
- Do 让绿色主按钮对应当前步骤的明确动作，用普通或安静按钮承载辅助操作。
- Do 让列表行、平台条件和参数表单按需展开，并保留长文换行与滚动空间。
- Do 在状态旁写出实际含义，分别说明参数检查、凭据检查、草稿、交接和公开发布。
- Do 保留可见焦点、真实 disabled/busy 状态、原生对话框语义以及减少动画偏好。

### Don't:

- Don't 把参数齐全、接口受理或扩展回执画成公开发布成功。
- Don't 用阴影堆叠替代页面分区；常驻内容容器沿用平面边线。
- Don't 给每一条记录添加独立大卡片；已有表格和连续列表保持统一密度。
- Don't 为说明设计而加入并不存在的用户成绩、真实账号或远端发布证据。
- Don't 在改动视觉时取消未保存保护、明确重试或结果核对步骤。

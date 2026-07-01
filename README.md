# 作图需求提交系统

运营选择类型、上传 Excel 表格，一键发送到钉钉群。

## 功能

- 选择任务类型（主图/A+/视频等）
- 上传 Excel 需求表格，自动解析
- 实时预览解析结果
- 一键发送到钉钉群（Markdown 格式）

## 部署到 Cloudflare Pages

### 1. 准备钉钉机器人

在钉钉群里添加自定义机器人：

1. 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 设置安全方式为"自定义关键词"，填入：`作图需求`
3. 复制 Webhook 地址，格式类似：
   ```
   https://oapi.dingtalk.com/robot/send?access_token=xxxxx
   ```

### 2. 推送代码到 GitHub

```bash
cd ai-image-prompt-gen
git init
git add .
git commit -m "初始化作图需求提交系统"
git branch -M main
git remote add origin https://github.com/你的用户名/ai-image-prompt-gen.git
git push -u origin main
```

### 3. 部署到 Cloudflare Pages

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 选择你的 GitHub 仓库 `ai-image-prompt-gen`
4. 构建设置：
   - **Framework preset**: None
   - **Build command**: 留空
   - **Build output directory**: `/`
5. 点击 **Save and Deploy**

### 4. 配置环境变量

部署完成后：

1. 进入项目设置 → **Settings** → **Environment variables**
2. 添加变量：
   - **Variable name**: `DINGTALK_WEBHOOK`
   - **Value**: 粘贴你的钉钉机器人 Webhook 地址
   - **Environment**: Production
3. 点击 **Save**
4. 回到 **Deployments**，点击最新部署右侧的三个点 → **Retry deployment**

### 5. 完成

访问你的网站地址（类似 `https://ai-image-prompt-gen.pages.dev`），上传表格测试。

## 本地开发（可选）

如果需要本地测试：

```bash
npm install
npm run dev
```

访问 `http://localhost:8788`

本地开发时，在项目根目录创建 `.dev.vars` 文件：

```
DINGTALK_WEBHOOK=你的webhook地址
```

## 文件说明

```
.
├── index.html              # 前端页面
├── style.css              # 样式
├── app.js                 # 前端逻辑：解析 Excel + 调用 API
├── functions/
│   └── api/
│       └── notify.js      # Cloudflare Function：转发钉钉
├── package.json
└── README.md
```

## 表格格式要求

Excel 表格需包含以下字段：

- **型号**：产品型号
- **交表时间**：提交日期
- **变体数及图片套数**：整体要求
- **图片序号**：标记图片需求开始，后续每行为一张图的需求

## 技术栈

- 纯静态前端（HTML + CSS + JS）
- SheetJS 解析 Excel
- Cloudflare Pages Functions 转发钉钉通知

## 许可

MIT

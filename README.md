# RSS 自定义订阅生成器

一个可以从任意网站提取内容、自动生成 RSS 订阅源的工具。通过 GitHub Actions 定时运行，实现订阅源自动更新。

## 功能特点

- **可视化规则配置**：通过前端页面可视化配置提取规则，无需写代码
- **自动更新**：GitHub Actions 定时抓取，RSS 内容自动更新
- **多订阅源**：支持在一个仓库中管理多个 RSS 订阅源
- **规则灵活**：使用 `{%}` 提取内容、`{*}` 忽略内容，语法简单直观
- **前后端一致**：前端预览和后端生成使用完全相同的提取引擎

## 文件结构

```
.
├── .github/
│   └── workflows/
│       └── update-rss.yml      # GitHub Actions 工作流配置
├── feeds/                       # 生成的 RSS XML 文件目录（自动创建）
│   └── *.xml
├── generate.js                  # RSS 生成脚本（核心）
├── package.json                 # Node.js 依赖配置
├── sources.json                 # 订阅源配置文件
├── rss-builder.html             # 前端配置工具页面
└── README.md                    # 说明文档
```

## 快速开始

### 1. 准备工作

- 一个 GitHub 账号
- 新建一个公开仓库

### 2. 部署步骤

1. 将以下文件上传到你的 GitHub 仓库：
   - `generate.js`
   - `package.json`
   - `sources.json`
   - `.github/workflows/update-rss.yml`

2. 在仓库设置中启用 GitHub Pages：
   - Settings → Pages
   - Source 选择 `Deploy from a branch`
   - Branch 选择 `gh-pages` 分支，目录选择 `/ (root)`

3. 使用 `rss-builder.html` 配置你的订阅源：
   - 在浏览器中打开 `rss-builder.html`
   - 按四步操作生成 `sources.json`
   - 将生成的内容替换仓库中的 `sources.json`

4. 提交更改后，GitHub Actions 会自动运行：
   - 在 Actions 标签页可以查看运行状态
   - 首次运行后会创建 `gh-pages` 分支

### 3. 访问 RSS

部署成功后，RSS 订阅链接格式为：

```
https://你的用户名.github.io/仓库名/feeds/feed-id.xml
```

例如：`https://john.github.io/my-rss/feeds/tech-news.xml`

## 提取规则语法

### 基本语法

| 符号 | 含义 | 说明 |
|------|------|------|
| `{%}` | 提取内容 | 标记需要提取的部分，按顺序编号为 {%1}, {%2}, {%3}... |
| `{*}` | 忽略内容 | 标记可变/不需要的部分，匹配任意内容（非贪婪） |

### 规则编写步骤

1. 在浏览器中打开目标网页，按 F12 打开开发者工具
2. 找到包含目标内容的 HTML 结构
3. 复制一段包含目标内容的 HTML 代码
4. 将需要提取的内容替换为 `{%}`
5. 将可能变化的内容替换为 `{*}`
6. 保持其余部分不变（作为定位锚点）

### 示例

假设网页源码如下：

```html
<div class="article">
  <h2 class="title">文章标题</h2>
  <a href="/article/123.html" class="link">阅读全文</a>
  <div class="summary">文章摘要内容...</div>
  <span class="date">2024-01-01</span>
</div>
```

提取规则可以写为：

```
<div class="article">
  <h2 class="title">{%}</h2>
  <a href="{%}" class="link">{*}</a>
  <div class="summary">{%}</div>
```

提取结果（3个字段）：
- `{%1}` = 文章标题
- `{%2}` = /article/123.html
- `{%3}` = 文章摘要内容...

### 注意事项

- 规则中的固定文本（HTML标签、类名等）必须与源码**完全一致**
- 尽量选择足够独特的锚点，避免匹配到不相关的内容
- `{*}` 是**非贪婪**匹配，会尽可能短地匹配
- 如果提取结果为空或不对，尝试调整规则的起止位置

## sources.json 配置说明

```json
{
  "feeds": [
    {
      "id": "feed-1",
      "name": "订阅源名称",
      "url": "https://example.com",
      "description": "订阅源描述",
      "rule": "提取规则文本",
      "options": {
        "stripHtml": true,
        "decodeEntities": true,
        "trimContent": true
      },
      "tpl": {
        "title": "{%1}",
        "link": "{%2}",
        "content": "{%3}"
      },
      "maxItems": 50,
      "updateInterval": "daily",
      "language": "zh-CN"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 订阅源唯一标识，用于生成文件名 |
| `name` | string | 是 | 订阅源名称，显示在 RSS 中 |
| `url` | string | 是 | 目标网页 URL |
| `description` | string | 否 | 订阅源描述 |
| `rule` | string | 是 | 提取规则 |
| `options.stripHtml` | boolean | 否 | 是否去除 HTML 标签，默认 true |
| `options.decodeEntities` | boolean | 否 | 是否解码 HTML 实体，默认 true |
| `options.trimContent` | boolean | 否 | 是否去除首尾空白，默认 true |
| `tpl.title` | string | 否 | 条目标题模板，默认 `{%1}` |
| `tpl.link` | string | 否 | 条目链接模板，默认 `{%2}` |
| `tpl.content` | string | 否 | 条目内容模板，默认 `{%3}` |
| `maxItems` | number | 否 | 最大条目数，默认 50 |
| `language` | string | 否 | 语言，默认 zh-CN |

## 自定义更新频率

修改 `.github/workflows/update-rss.yml` 中的 cron 表达式：

```yaml
schedule:
  - cron: '0 0,6,12,18 * * *'  # 每6小时一次
```

常用 cron 表达式：

| 频率 | cron 表达式 (UTC) | 对应北京时间 |
|------|-------------------|-------------|
| 每小时 | `0 * * * *` | 每小时 |
| 每6小时 | `0 0,6,12,18 * * *` | 8点, 14点, 20点, 2点 |
| 每天 | `0 0 * * *` | 每天 8:00 |
| 每天两次 | `0 0,12 * * *` | 8:00, 20:00 |

> 注意：cron 使用 UTC 时间，北京时间 = UTC + 8 小时

## 常见问题

### Q: 为什么提取不到内容？

A: 可能原因：
1. 规则与实际源码不完全匹配（注意空格、换行、引号类型）
2. 网站内容是 JavaScript 动态渲染的（此工具只能获取初始 HTML）
3. 网站有反爬机制，拒绝了 GitHub Actions 的请求

### Q: 支持 JavaScript 渲染的页面吗？

A: 当前版本不支持。如果目标网站内容是 JS 动态渲染的，需要使用 Puppeteer/Playwright 等无头浏览器方案。

### Q: 一个仓库可以放多个订阅源吗？

A: 可以。在 `sources.json` 的 `feeds` 数组中添加多个配置即可，每个 feed 有独立的 id 和输出文件。

### Q: GitHub Actions 运行失败怎么办？

A: 查看 Actions 标签页的运行日志，检查：
1. `sources.json` 格式是否正确（可用 JSON 校验工具检查）
2. 目标网站是否可访问
3. 提取规则是否正确

### Q: 如何手动触发更新？

A: 在仓库的 Actions 页面，选择 "Update RSS Feeds" 工作流，点击 "Run workflow" 按钮即可手动触发。

## 技术实现

- **前端**：纯 HTML/JS，无需后端，可本地打开使用
- **后端**：Node.js 脚本，零依赖（可选 iconv-lite 用于编码转换）
- **部署**：GitHub Actions + GitHub Pages
- **提取引擎**：基于正则表达式的规则匹配，前后端共用同一逻辑

## 许可证

MIT License

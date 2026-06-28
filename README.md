# RSS 自定义订阅生成器 - 完整操作指南

从任意网站提取内容，生成可自动更新的 RSS 订阅源。基于 GitHub Actions 定时运行，无需服务器。

## 快速导航

- [文件说明](#文件说明)
- [部署步骤（从零开始）](#部署步骤从零开始)
- [制作 RSS 订阅的完整流程](#制作-rss-订阅的完整流程)
- [多订阅源配置](#多订阅源配置)
- [提取规则编写指南](#提取规则编写指南)
- [常见问题](#常见问题)

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `rss-builder.html` | 本地配置工具，在浏览器中打开使用 |
| `generate.js` | 后端 RSS 生成脚本，GitHub Actions 运行 |
| `sources.json` | 订阅源配置，所有订阅源都在这里管理 |
| `.github/workflows/update-rss.yml` | GitHub Actions 自动更新工作流 |
| `package.json` | Node.js 配置（generate.js 零依赖） |
| `feeds/` | RSS 输出目录（由 Actions 自动生成到 gh-pages 分支） |

---

## 部署步骤（从零开始）

### 第 1 步：创建 GitHub 仓库

1. 登录 GitHub，点击右上角 **+** → **New repository**
2. 仓库名随意，比如 `rss-builder`
3. 选择 **Public**（公开仓库才能免费使用 GitHub Pages）
4. 勾选 **Add a README file**
5. 点击 **Create repository**

### 第 2 步：上传必要文件

将以下文件上传到仓库根目录：

- `generate.js`
- `sources.json`
- `package.json`
- `.github/workflows/update-rss.yml`

> 注意：`.github/workflows/` 是目录结构，upload 时选择 **Add file** → **Create new file**，路径填 `.github/workflows/update-rss.yml`

### 第 3 步：启用 GitHub Pages

1. 进入仓库 → **Settings** → **Pages**
2. **Build and deployment** → **Source** 选择 **Deploy from a branch**
3. **Branch** 选择 **gh-pages**（第一次运行 Actions 后才会有这个分支）
4. 目录选择 **/ (root)**
5. 点击 **Save**

> 如果暂时没有 `gh-pages` 分支，先做第 4 步触发一次运行，再回来设置。

### 第 4 步：手动触发一次运行

1. 进入仓库 → **Actions**
2. 左侧选择 **Update RSS Feeds**
3. 点击 **Run workflow** → 选择 **main** 分支 → **Run workflow**
4. 等待运行完成（约 1-2 分钟）

运行成功后：
- 会自动创建 `gh-pages` 分支
- RSS 文件会生成在 `gh-pages` 分支根目录

### 第 5 步：验证

访问你的 RSS 链接，格式：

```
https://你的用户名.github.io/仓库名/feed-id.xml
```

例如：`https://hanyee2023.github.io/rss-builder/kongquehai.xml`

> 注意：文件在 **gh-pages 分支**，不在 main 分支的 feeds 目录里！

---

## 制作 RSS 订阅的完整流程

### 第一步：获取网页源码

1. 在浏览器中打开 `rss-builder.html`
2. 在「目标网站地址」输入要生成 RSS 的网页 URL
3. 点击「解析源码」按钮
   - 如果解析失败，选择「手动粘贴」模式：
     - 打开目标网页，按 **F12** 打开开发者工具
     - 在 Elements 面板中，右键最外层 `<html>` 标签 → **Copy** → **Copy outerHTML**
     - 粘贴到源码区域

### 第二步：编写提取规则

这是最关键的一步。规则语法：

| 符号 | 含义 |
|------|------|
| `{%}` | 提取内容（按出现顺序编号为 {%1} {%2} {%3}...） |
| `{*}` | 忽略内容（通配符，匹配任意内容） |

**编写方法：**

1. 从源码中找到包含目标内容的一段 HTML 结构
2. 复制这段代码到规则输入框
3. 把要提取的内容替换为 `{%}`
4. 把会变化的内容替换为 `{*}`
5. 其余部分保持不变（作为定位锚点）
6. 点击「提取内容」按钮验证是否正确

**示例：**

源码片段：
```html
<div class="post">
  <h2 class="title">文章标题</h2>
  <a href="/post/123.html">阅读全文</a>
  <p class="summary">文章摘要内容</p>
</div>
```

提取规则：
```
<h2 class="title">{%}</h2>
<a href="{%}">{*}</a>
<p class="summary">{%}</p>
```

提取结果（3个字段）：
- `{%1}` = 文章标题
- `{%2}` = /post/123.html
- `{%3}` = 文章摘要内容

> 💡 **技巧**：尽量选择独特的、不会重复的 HTML 结构作为锚点。class 名、标签名越具体越好。

### 第三步：配置 RSS 信息

1. 填写「订阅源名称」和「描述」
2. 配置模板：
   - **条目标题模板**：每条 RSS 条目的标题，用 `{%1}` 等引用提取的字段
   - **条目链接模板**：每条 RSS 条目的链接，支持相对路径（自动补全）
   - **条目内容模板**：每条 RSS 条目的正文，支持 HTML
3. 设置 **Feed ID**（比如 `kongquehai`、`tech-news`），这会作为 RSS 文件名
4. 填写 GitHub 用户名和仓库名（自动生成订阅链接）
5. 点击「生成 RSS」按钮预览效果

### 第四步：生成并部署

1. 点击「生成 sources.json」按钮
2. 点击「复制 JSON」或「下载 sources.json」
3. 将内容粘贴/上传到 GitHub 仓库的 `sources.json` 文件
4. 提交更改，GitHub Actions 会自动运行
5. 等待 1-2 分钟后，访问生成的 RSS 链接

---

## 多订阅源配置

`sources.json` 支持多个订阅源，格式如下：

```json
{
  "feeds": [
    {
      "id": "feed-1",
      "name": "订阅源1名称",
      "url": "https://site1.com",
      "description": "描述1",
      "rule": "提取规则1",
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
    },
    {
      "id": "feed-2",
      "name": "订阅源2名称",
      "url": "https://site2.com",
      "description": "描述2",
      "rule": "提取规则2",
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
      "maxItems": 30,
      "updateInterval": "6h",
      "language": "zh-CN"
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一标识，同时作为 RSS 文件名（如 `id: "news"` → `news.xml`） |
| `name` | ✅ | 订阅源名称，显示在 RSS 阅读器中 |
| `url` | ✅ | 目标网页 URL |
| `description` | - | 订阅源描述 |
| `rule` | ✅ | 提取规则 |
| `options.stripHtml` | - | 是否去除 HTML 标签，默认 true |
| `options.decodeEntities` | - | 是否解码 HTML 实体，默认 true |
| `options.trimContent` | - | 是否去除首尾空白，默认 true |
| `tpl.title` | - | 标题模板，默认 `{%1}` |
| `tpl.link` | - | 链接模板，默认 `{%2}` |
| `tpl.content` | - | 内容模板，默认 `{%3}` |
| `maxItems` | - | 最大条目数，默认 50 |
| `language` | - | 语言，默认 zh-CN |

### 添加新订阅源的步骤

1. 用 `rss-builder.html` 配置好新的订阅源
2. 生成并复制 JSON
3. 打开 GitHub 仓库的 `sources.json`
4. 在 `feeds` 数组中添加新的配置对象（注意逗号分隔）
5. 提交保存

---

## 提取规则编写指南

### 基本原则

1. **锚点要独特**：固定部分（非 `{%}` 和 `{*}` 的部分）要足够独特，避免匹配到错误的位置
2. **锚点要稳定**：选择网站不会轻易改动的结构（如 class 名、标签层级）
3. **`{*}` 要够用**：可能变化的内容都用 `{*}` 代替，避免因微小变化导致提取失败
4. **`{%}` 数量要清楚**：数清楚有几个 `{%}`，对应 `{%1}` `{%2}`...

### 常见场景

#### 场景 1：提取列表中的标题和链接

```html
<ul class="news-list">
  <li><a href="/article/1.html">新闻标题1</a></li>
  <li><a href="/article/2.html">新闻标题2</a></li>
</ul>
```

规则：
```
<li><a href="{%}">{%}</a></li>
```

结果：
- `{%1}` = 链接地址
- `{%2}` = 标题

#### 场景 2：提取包含图片的内容

```html
<div class="item">
  <img src="/thumb/1.jpg" class="thumb">
  <h3>标题文字</h3>
  <p>摘要内容...</p>
</div>
```

规则：
```
<img src="{%}" class="thumb">
<h3>{%}</h3>
<p>{%}</p>
```

如果想在内容模板中保留图片，关闭「去除HTML标签」选项，并把规则写成：
```
<div class="item">
  {*}
  <h3>{%}</h3>
  <p>{%}</p>
</div>
```

然后在内容模板中手动拼接图片：
```
<img src="{%1}">
<p>{%3}</p>
```

#### 场景 3：内容中有换行和空格

源码中的换行和空格要与规则**完全一致**。如果不确定，可以只取一行或用 `{*}` 代替空白部分。

### 调试技巧

1. **先短后长**：先用一小段规则测试，确认能匹配到，再逐步扩大范围
2. **对照检查**：提取失败时，把规则和源码并排对比，检查是否有细微差别（空格、换行、引号类型）
3. **浏览器辅助**：F12 开发者工具的 Elements 面板中，右键元素 → **Copy** → **Copy outerHTML**，粘贴后再修改

---

## 常见问题

### Q: Actions 显示成功，但 RSS 链接 404？

A: 检查以下几点：
1. 确认 GitHub Pages 已启用，且选择了 **gh-pages** 分支
2. RSS 文件在 **gh-pages 分支**，不在 main 分支
3. 链接格式：`https://用户名.github.io/仓库名/feed-id.xml`（没有 `/feeds/` 前缀）
4. 首次部署后可能需要等几分钟才能访问

### Q: 提取不到内容怎么办？

A: 常见原因：
1. 规则与源码不完全匹配（空格、换行、引号类型等）
2. 网站内容是 JavaScript 动态渲染的（此工具只能获取初始 HTML）
3. 规则太长，中间包含了太多可变内容
4. 解决方法：缩短规则，用更多 `{*}` 代替可变部分

### Q: 支持 JavaScript 渲染的页面吗？

A: 当前版本不支持。如果目标网站是 SPA（React/Vue 等），需要使用 Puppeteer 等无头浏览器方案。

### Q: 更新频率可以自定义吗？

A: 可以。修改 `.github/workflows/update-rss.yml` 中的 cron 表达式。GitHub Actions 的最短间隔是 5 分钟，但不建议太频繁。

常用 cron 示例（UTC 时间，北京时间 = UTC + 8）：

| 频率 | cron 表达式 | 对应北京时间 |
|------|------------|-------------|
| 每小时 | `0 * * * *` | 每小时 |
| 每6小时 | `0 0,6,12,18 * * *` | 8点, 14点, 20点, 2点 |
| 每天早上 | `0 0 * * *` | 每天 8:00 |
| 每天早晚 | `0 0,12 * * *` | 8:00, 20:00 |

### Q: 一个仓库最多可以有多少个订阅源？

A: 没有硬性限制。但如果订阅源太多，单次运行时间可能超过 GitHub Actions 的免费时长限制（公开仓库每月 2000 分钟）。建议 10-20 个以内比较稳妥。

### Q: 如何查看 RSS 是否正常工作？

A: 几种方法：
1. 直接在浏览器中打开 RSS 链接，看是否显示 XML 内容
2. 用 RSS 阅读器（如 Feedly、Inoreader、NetNewsWire）添加订阅
3. 在线 RSS 验证工具：https://validator.w3.org/feed/

### Q: 订阅源管理在哪里？

A: 所有订阅源都在 `sources.json` 文件中管理。直接编辑这个文件即可添加、修改、删除订阅源。GitHub 仓库是唯一的数据源。

---

## 技术说明

- **前端**：纯 HTML/JS，零依赖，本地浏览器运行
- **后端**：Node.js 脚本，仅使用内置模块，零依赖
- **部署**：GitHub Actions + GitHub Pages
- **提取引擎**：基于正则表达式，前后端使用完全相同的逻辑

## 许可证

MIT

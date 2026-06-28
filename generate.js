#!/usr/bin/env node
/**
 * RSS Feed Generator
 * 
 * 从 sources.json 中读取订阅源配置，抓取网页，提取内容，生成 RSS XML 文件。
 * 同时生成订阅源索引页 index.html，方便查看和管理所有订阅源。
 * 
 * 【重要】此文件中的提取规则引擎必须与前端 rss-builder.html 中的
 * extractWithRule 函数逻辑完全一致，以确保前后端提取结果相同。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================================
// 配置
// ============================================================
const SOURCES_FILE = path.join(__dirname, 'sources.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const FEEDS_DIR = path.join(OUTPUT_DIR, 'feeds');
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; RSS-Builder/2.0; +https://github.com/)';

// ============================================================
// 主函数
// ============================================================
async function main() {
    console.log('=== RSS Feed Generator 启动 ===');
    console.log(`时间: ${new Date().toISOString()}`);

    // 1. 读取 sources.json
    const sources = loadSources();
    if (!sources || !sources.feeds || sources.feeds.length === 0) {
        console.log('没有找到订阅源配置，退出');
        return;
    }

    console.log(`找到 ${sources.feeds.length} 个订阅源`);

    // 2. 确保输出目录存在
    if (!fs.existsSync(FEEDS_DIR)) {
        fs.mkdirSync(FEEDS_DIR, { recursive: true });
        console.log(`创建输出目录: ${FEEDS_DIR}`);
    }

    // 3. 逐个生成 RSS
    const results = [];
    for (const feed of sources.feeds) {
        console.log(`\n--- 处理: ${feed.name || feed.id} ---`);
        try {
            const result = await generateFeed(feed);
            results.push(result);
            console.log(`  ✓ 成功: 生成 ${result.itemCount} 条记录 -> feeds/${result.filename}`);
        } catch (err) {
            console.error(`  ✗ 失败: ${err.message}`);
            results.push({
                id: feed.id,
                name: feed.name,
                success: false,
                error: err.message,
            });
        }
    }

    // 4. 生成索引页
    generateIndexPage(results);
    console.log('\n✓ 索引页已生成: index.html');

    // 5. 输出汇总
    console.log('\n=== 生成汇总 ===');
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    console.log(`成功: ${successCount}, 失败: ${failCount}`);

    if (failCount > 0) {
        console.log('\n失败详情:');
        results.filter(r => !r.success).forEach(r => {
            console.log(`  - ${r.name || r.id}: ${r.error}`);
        });
    }

    console.log('\n=== 完成 ===');
}

// ============================================================
// 加载 sources.json
// ============================================================
function loadSources() {
    if (!fs.existsSync(SOURCES_FILE)) {
        throw new Error(`找不到配置文件: ${SOURCES_FILE}`);
    }
    try {
        const content = fs.readFileSync(SOURCES_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        throw new Error(`解析 sources.json 失败: ${err.message}`);
    }
}

// ============================================================
// 生成单个 Feed
// ============================================================
async function generateFeed(feed) {
    const {
        id,
        name = 'RSS Feed',
        url,
        description = name,
        rule,
        options = {},
        tpl = { title: '{%1}', link: '{%2}', content: '{%3}' },
        maxItems = 50,
        language = 'zh-CN',
    } = feed;

    if (!id) throw new Error('缺少 feed id');
    if (!url) throw new Error('缺少目标 url');
    if (!rule) throw new Error('缺少提取规则 rule');

    // 1. 抓取网页
    const html = await fetchPage(url);
    console.log(`  抓取完成，源码长度: ${html.length} 字符`);

    // 2. 提取内容
    const extractedData = extractWithRule(html, rule, options);
    console.log(`  提取完成，共 ${extractedData.length} 条记录`);

    if (extractedData.length === 0) {
        console.warn('  警告: 没有提取到任何内容，将生成空feed');
    }

    // 3. 生成 RSS XML
    const rssXml = buildRssXml({
        title: name,
        description,
        link: url,
        language,
        items: extractedData.slice(0, maxItems),
        tpl,
        baseUrl: url,
    });

    // 4. 写入文件
    const filename = `${id}.xml`;
    const filePath = path.join(FEEDS_DIR, filename);
    fs.writeFileSync(filePath, rssXml, 'utf-8');

    return {
        id,
        name,
        description,
        url,
        success: true,
        itemCount: extractedData.length,
        filename,
        filePath,
    };
}

// ============================================================
// 生成索引页
// ============================================================
function generateIndexPage(results) {
    const successFeeds = results.filter(r => r.success);
    const failFeeds = results.filter(r => !r.success);
    const generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS 订阅源列表</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            background: #f5f7fa;
            color: #333;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
        h1 {
            font-size: 24px;
            color: #1a1a2e;
            margin-bottom: 8px;
        }
        .subtitle {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e9ecef;
        }
        .feed-list {
            list-style: none;
        }
        .feed-item {
            padding: 16px;
            border: 1px solid #e4e7ed;
            border-radius: 8px;
            margin-bottom: 12px;
            transition: all 0.2s;
        }
        .feed-item:hover {
            border-color: #1677ff;
            box-shadow: 0 2px 8px rgba(22,119,255,0.1);
        }
        .feed-name {
            font-size: 16px;
            font-weight: 600;
            color: #262626;
            margin-bottom: 4px;
        }
        .feed-desc {
            font-size: 13px;
            color: #8c8c8c;
            margin-bottom: 8px;
        }
        .feed-meta {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: #bfbfbf;
            margin-bottom: 10px;
        }
        .feed-link {
            display: inline-block;
            padding: 5px 14px;
            background: #e6f7ff;
            color: #1677ff;
            border-radius: 4px;
            font-size: 12px;
            text-decoration: none;
            font-family: 'Consolas', monospace;
            word-break: break-all;
        }
        .feed-link:hover {
            background: #bae7ff;
        }
        .feed-failed {
            border-color: #ffccc7;
            background: #fff2f0;
        }
        .feed-failed .feed-name {
            color: #ff4d4f;
        }
        .error-msg {
            color: #ff4d4f;
            font-size: 12px;
            margin-top: 6px;
        }
        .footer {
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid #e9ecef;
            font-size: 12px;
            color: #bfbfbf;
            text-align: center;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
            margin-left: 8px;
        }
        .badge-success { background: #f6ffed; color: #52c41a; }
        .badge-error { background: #fff2f0; color: #ff4d4f; }
    </style>
</head>
<body>
    <div class="container">
        <h1>RSS 订阅源列表 <span class="badge badge-success">${successFeeds.length} 个在线</span></h1>
        <p class="subtitle">共 ${results.length} 个订阅源 &middot; 生成时间: ${generatedAt}</p>

        <ul class="feed-list">
${successFeeds.map(feed => `            <li class="feed-item">
                <div class="feed-name">${escapeHtml(feed.name)} <span class="badge badge-success">${feed.itemCount} 条</span></div>
                <div class="feed-desc">${escapeHtml(feed.description || '')}</div>
                <div class="feed-meta">
                    <span>来源: ${escapeHtml(feed.url)}</span>
                </div>
                <a class="feed-link" href="feeds/${feed.filename}">feeds/${feed.filename}</a>
            </li>`).join('\n')}
${failFeeds.length > 0 ? failFeeds.map(feed => `            <li class="feed-item feed-failed">
                <div class="feed-name">${escapeHtml(feed.name)} <span class="badge badge-error">失败</span></div>
                <div class="error-msg">错误: ${escapeHtml(feed.error || '')}</div>
            </li>`).join('\n') : ''}
        </ul>

        <div class="footer">
            RSS-Builder &middot; 自动生成于 ${generatedAt}
        </div>
    </div>
</body>
</html>`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf-8');
}

// ============================================================
// 抓取网页
// ============================================================
function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            timeout: 30000,
        };

        const req = client.request(options, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).href;
                console.log(`  重定向到: ${redirectUrl}`);
                fetchPage(redirectUrl).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            // 处理编码
            const contentType = res.headers['content-type'] || '';
            let charset = 'utf-8';
            const charsetMatch = contentType.match(/charset=([\w-]+)/i);
            if (charsetMatch) {
                charset = charsetMatch[1].toLowerCase();
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                try {
                    let html;
                    if (charset === 'utf-8' || charset === 'utf8') {
                        html = buffer.toString('utf-8');
                    } else {
                        try {
                            const iconv = require('iconv-lite');
                            html = iconv.decode(buffer, charset);
                        } catch (e) {
                            console.warn(`  警告: 无法解码 ${charset}，使用 utf-8`);
                            html = buffer.toString('utf-8');
                        }
                    }
                    resolve(html);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时 (30s)'));
        });

        req.end();
    });
}

// ============================================================
// 核心提取函数 - 与前端保持完全一致
// 【重要】修改此函数时必须同步修改前端 rss-builder.html 中的 extractWithRule
// ============================================================
function extractWithRule(html, rule, options = {}) {
    const {
        stripHtml = true,
        decodeEntities = true,
        trimContent = true,
    } = options;

    // 将规则转换为正则表达式
    // 1. 先转义规则中的正则特殊字符（% 不是正则特殊字符，不会被转义）
    let escapedRule = rule
        .replace(/[-\/\\^$*+.?()|[\]{}]/g, '\\$&'); // 转义所有正则特殊字符

    // 2. 替换占位符
    //    转义后：{*} 变成 \{\*\}，{%} 变成 \{\%\}（%不被转义）
    const regStr = escapedRule
        .replace(/\\\{\\\*\\\}/g, '[\\s\\S]*?')   // {*} -> 非贪婪任意字符
        .replace(/\\\{%\\\}/g, '([\\s\\S]*?)');   // {%} -> 捕获组（非贪婪）

    const regex = new RegExp(regStr, 'g');
    const results = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
        // 防止零长度匹配导致死循环
        if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
        }

        const row = [];
        for (let i = 1; i < match.length; i++) {
            let val = match[i] != null ? match[i] : '';

            // 后处理
            if (stripHtml) {
                val = val.replace(/<[^>]*>/g, '');
            }
            if (decodeEntities) {
                val = decodeHtmlEntities(val);
            }
            if (trimContent) {
                val = val.trim();
            }

            row.push(val);
        }
        results.push(row);

        // 移动lastIndex，避免重叠匹配
        regex.lastIndex = match.index + match[0].length;
    }

    return results;
}

// ============================================================
// HTML 实体解码
// ============================================================
function decodeHtmlEntities(text) {
    const map = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' ',
        '&copy;': '©',
        '&reg;': '®',
        '&hellip;': '…',
        '&ldquo;': '"',
        '&rdquo;': '"',
        '&lsquo;': "'",
        '&rsquo;': "'",
        '&mdash;': '—',
        '&ndash;': '–',
        '&bull;': '•',
        '&trade;': '™',
    };

    let result = text;
    // 具名实体
    for (const [entity, char] of Object.entries(map)) {
        result = result.split(entity).join(char);
        result = result.split(entity.toUpperCase()).join(char);
    }
    // 数字实体 &#123;
    result = result.replace(/&#(\d+);/g, (_, num) => {
        try {
            return String.fromCharCode(parseInt(num, 10));
        } catch (e) {
            return _;
        }
    });
    // 十六进制实体 &#x1F;
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
            return String.fromCharCode(parseInt(hex, 16));
        } catch (e) {
            return _;
        }
    });
    return result;
}

// ============================================================
// 构建 RSS XML
// ============================================================
function buildRssXml({ title, description, link, language, items, tpl, baseUrl }) {
    const now = new Date().toUTCString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
    xml += '<channel>\n';
    xml += `  <title><![CDATA[${escapeCdata(title)}]]></title>\n`;
    xml += `  <description><![CDATA[${escapeCdata(description)}]]></description>\n`;
    xml += `  <link>${escapeXml(link)}</link>\n`;
    xml += `  <lastBuildDate>${now}</lastBuildDate>\n`;
    xml += `  <generator>RSS-Builder/2.0 (Node.js)</generator>\n`;
    xml += `  <language>${language}</language>\n`;

    items.forEach((row, index) => {
        let itemTitle = applyTemplate(tpl.title || '{%1}', row);
        let itemLink = applyTemplate(tpl.link || '{%2}', row);
        let itemContent = applyTemplate(tpl.content || '{%3}', row);

        // URL 补全
        if (itemLink && baseUrl) {
            try {
                itemLink = new URL(itemLink, baseUrl).href;
            } catch (e) {
                // 无效URL，保持原样
            }
        }

        // 生成稳定 guid
        const guid = generateGuid(itemTitle + itemLink + index);

        xml += '  <item>\n';
        xml += `    <title><![CDATA[${escapeCdata(itemTitle)}]]></title>\n`;
        xml += `    <link>${escapeXml(itemLink)}</link>\n`;
        xml += `    <description><![CDATA[${escapeCdata(itemContent)}]]></description>\n`;
        xml += `    <guid isPermaLink="false">${escapeXml(guid)}</guid>\n`;
        xml += `    <pubDate>${new Date(Date.now() - index * 60000).toUTCString()}</pubDate>\n`;
        xml += '  </item>\n';
    });

    xml += '</channel>\n';
    xml += '</rss>\n';

    return xml;
}

// ============================================================
// 模板替换
// ============================================================
function applyTemplate(template, row) {
    let result = template;
    for (let i = 0; i < row.length; i++) {
        const placeholder = `{%${i + 1}}`;
        result = result.split(placeholder).join(row[i] || '');
    }
    return result;
}

// ============================================================
// 工具函数
// ============================================================
function escapeCdata(text) {
    return (text || '').replace(/]]>/g, ']]>]]&gt;<![CDATA[');
}

function escapeXml(text) {
    return (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeHtml(text) {
    return (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateGuid(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'item-' + Math.abs(hash).toString(36);
}

// ============================================================
// 启动
// ============================================================
main().catch(err => {
    console.error('致命错误:', err);
    process.exit(1);
});

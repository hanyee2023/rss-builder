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
const zlib = require('zlib');
const { URL } = require('url');

// Puppeteer 用于浏览器渲染抓取（可选，当 proxy === 'puppeteer' 时启用）
let puppeteer = null;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    // puppeteer 未安装，跳过
}

// ============================================================
// 配置
// ============================================================
const SOURCES_FILE = path.join(__dirname, 'sources.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const FEEDS_DIR = path.join(OUTPUT_DIR, 'feeds');

// 使用真实 Chrome 浏览器的 User-Agent，最大程度模拟真实浏览器
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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

    // 3. 逐个生成 RSS（每个最多 60 秒，超时自动跳过）
    const results = [];
    for (const feed of sources.feeds) {
        console.log(`\n--- 处理: ${feed.name || feed.id} ---`);
        try {
            const result = await withTimeout(generateFeed(feed), 60000, `处理超时（超过 60 秒）`);
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

    // 5. 复制在线生成器
    copyRssBuilder();

    // 6. 输出汇总
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
        proxy = false,
    } = feed;

    if (!id) throw new Error('缺少 feed id');
    if (!url) throw new Error('缺少目标 url');
    if (!rule) throw new Error('缺少提取规则 rule');

    // 1. 抓取网页
    const html = await fetchPage(url, 0, proxy);
    console.log(`  抓取完成，源码长度: ${html.length} 字符`);

    // 2. 提取内容
    const extractedData = extractWithRule(html, rule, options);
    console.log(`  提取完成，共 ${extractedData.length} 条记录`);

    if (extractedData.length === 0) {
        console.warn('  警告: 没有提取到任何内容，将生成空feed');
        // 输出 HTML 片段供调试：前 2000 字符，帮助对比规则是否匹配
        console.log('  --- HTML 片段（前 2000 字符）---');
        console.log(html.substring(0, 2000));
        console.log('  --- HTML 片段结束 ---');
        console.log(`  --- 使用的规则 ---`);
        console.log(rule);
        console.log('  --- 规则结束 ---');
    }

    // 2.5 视频直链二次提取（按需）：跳转到详情页取真实视频地址
    if (feed.videoExtract) {
        await enrichWithVideoLinks(extractedData, { url, tpl, options, proxy, feed });
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
        videoEmbed: feed.videoEmbed === true,
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
        .builder-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 20px;
            padding: 12px 16px;
            background: #f0f7ff;
            border: 1px solid #d6e9ff;
            border-radius: 8px;
        }
        .builder-bar-text {
            font-size: 13px;
            color: #4a6fa5;
        }
        .builder-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: #1677ff;
            color: white;
            border-radius: 6px;
            text-decoration: none;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .builder-btn:hover {
            background: #4096ff;
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(22,119,255,0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>RSS 订阅源列表 <span class="badge badge-success">${successFeeds.length} 个在线</span></h1>
        <p class="subtitle">共 ${results.length} 个订阅源 &middot; 生成时间: ${generatedAt}</p>

        <div class="builder-bar">
            <span class="builder-bar-text">在线配置新订阅源，无需安装任何工具</span>
            <a href="rss-builder.html" class="builder-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                新建 RSS 订阅源
            </a>
        </div>

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
// 抓取网页 - 最大程度模拟真实 Chrome 浏览器
// 支持 proxy 参数：true 使用默认代理，字符串使用自定义代理
// ============================================================
function fetchPage(url, retryCount = 0, proxy = false) {
    if (proxy === 'puppeteer') {
        return fetchWithPuppeteer(url);
    }
    if (proxy) {
        return fetchWithProxy(url, retryCount, proxy);
    }
    return fetchDirect(url, retryCount);
}

// ============================================================
// 浏览器渲染抓取 - 使用 Puppeteer 启动真实 Chromium
// 能拿到 JS 渲染后的完整 HTML，和 F12 结果一致
// ============================================================
async function fetchWithPuppeteer(targetUrl) {
    if (!puppeteer) {
        throw new Error('Puppeteer 未安装。请在 GitHub Actions 中添加 npm install puppeteer 步骤。');
    }

    const start = Date.now();
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // 导航并等待网络空闲（JS 执行完成）
        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // 额外等待，确保延迟加载的内容也渲染完成
        await new Promise(resolve => setTimeout(resolve, 2000));

        const html = await page.content();
        await browser.close();

        const elapsed = Date.now() - start;
        console.log(`  Puppeteer 抓取完成: ${html.length} 字符, ${elapsed}ms`);
        return html;
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        throw new Error(`Puppeteer 抓取失败: ${err.message}`);
    }
}

// ============================================================
// 通过代理抓取 - 解决 403 等 IP 封禁问题
// 支持：
//   - true → 使用默认代理 api.allorigins.win
//   - "https://xxx.workers.dev/fetch?url=" → 使用 Worker 代理（返回 JSON { html })
//   - "https://other-proxy/raw?url=" → 使用其他代理（直接返回 HTML）
// ============================================================
function fetchWithProxy(url, retryCount = 0, proxyConfig) {
    let proxyUrl;
    let isWorkerProxy = false;

    if (typeof proxyConfig === 'string' && proxyConfig.length > 0) {
        proxyUrl = proxyConfig;
        // 检测是否是 Worker 代理（路径包含 /fetch）
        isWorkerProxy = proxyConfig.includes('/fetch');
    } else {
        proxyUrl = 'https://api.allorigins.win/raw?url=';
    }

    const fullUrl = proxyUrl + encodeURIComponent(url);

    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(fullUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
            },
            timeout: 30000,
        };

        const req = client.request(options, (res) => {
            if (res.statusCode !== 200) {
                if (retryCount < 2) {
                    console.log(`  (代理) HTTP ${res.statusCode}，${2 - retryCount} 秒后重试...`);
                    setTimeout(() => {
                        fetchWithProxy(url, retryCount + 1, proxyConfig).then(resolve).catch(reject);
                    }, 2000);
                    return;
                }
                reject(new Error(`(代理) HTTP ${res.statusCode}`));
                return;
            }

            const encoding = res.headers['content-encoding'];
            let stream = res;
            if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
            else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());

            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let html;

                if (isWorkerProxy) {
                    // Worker 返回 JSON { success, html, ... }
                    try {
                        const data = JSON.parse(buffer.toString('utf-8'));
                        if (data.success && data.html) {
                            html = data.html;
                        } else {
                            reject(new Error(`Worker 返回错误: ${data.error || '未知错误'}`));
                            return;
                        }
                    } catch (e) {
                        reject(new Error('Worker 返回的不是有效 JSON'));
                        return;
                    }
                } else {
                    html = buffer.toString('utf-8');
                }

                resolve(html);
            });
            stream.on('error', reject);
        });

        req.on('error', (err) => {
            if (retryCount < 2) {
                console.log(`  (代理) 请求失败: ${err.message}，${2 - retryCount} 秒后重试...`);
                setTimeout(() => {
                    fetchWithProxy(url, retryCount + 1, proxyConfig).then(resolve).catch(reject);
                }, 2000);
            } else {
                reject(err);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retryCount < 2) {
                console.log(`  (代理) 请求超时，${2 - retryCount} 秒后重试...`);
                setTimeout(() => {
                    fetchWithProxy(url, retryCount + 1, proxyConfig).then(resolve).catch(reject);
                }, 2000);
            } else {
                reject(new Error('(代理) 请求超时'));
            }
        });

        req.end();
    });
}

// ============================================================
// 直接抓取网页
// ============================================================
function fetchDirect(url, retryCount = 0) {
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
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'Connection': 'keep-alive',
            },
            timeout: 30000,
        };

        const req = client.request(options, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).href;
                console.log(`  重定向到: ${redirectUrl}`);
                fetchPage(redirectUrl, retryCount).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                // 对于 403/429 等可能反爬的状态码，尝试重试
                if ((res.statusCode === 403 || res.statusCode === 429) && retryCount < 2) {
                    console.log(`  HTTP ${res.statusCode}，${2 - retryCount} 秒后重试...`);
                    setTimeout(() => {
                        fetchPage(url, retryCount + 1).then(resolve).catch(reject);
                    }, 2000);
                    return;
                }
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            // 处理压缩
            const encoding = res.headers['content-encoding'];
            let stream = res;
            if (encoding === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (encoding === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            } else if (encoding === 'br') {
                stream = res.pipe(zlib.createBrotliDecompress());
            }

            // 处理编码
            const contentType = res.headers['content-type'] || '';
            let charset = 'utf-8';
            const charsetMatch = contentType.match(/charset=([\w-]+)/i);
            if (charsetMatch) {
                charset = charsetMatch[1].toLowerCase();
            }

            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                try {
                    let html;
                    if (charset === 'utf-8' || charset === 'utf8') {
                        html = buffer.toString('utf-8');
                    } else if (charset === 'gbk' || charset === 'gb2312') {
                        // GBK/GB2312 使用 iconv-lite
                        try {
                            const iconv = require('iconv-lite');
                            html = iconv.decode(buffer, charset);
                        } catch (e) {
                            console.warn(`  警告: 无法解码 ${charset}，使用 utf-8`);
                            html = buffer.toString('utf-8');
                        }
                    } else {
                        html = buffer.toString('utf-8');
                    }
                    resolve(html);
                } catch (err) {
                    reject(err);
                }
            });
            stream.on('error', reject);
        });

        req.on('error', (err) => {
            if (retryCount < 2) {
                console.log(`  请求失败: ${err.message}，${2 - retryCount} 秒后重试...`);
                setTimeout(() => {
                    fetchPage(url, retryCount + 1).then(resolve).catch(reject);
                }, 2000);
            } else {
                reject(err);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retryCount < 2) {
                console.log(`  请求超时，${2 - retryCount} 秒后重试...`);
                setTimeout(() => {
                    fetchPage(url, retryCount + 1).then(resolve).catch(reject);
                }, 2000);
            } else {
                reject(new Error('请求超时 (30s)，已重试 2 次'));
            }
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
// 视频直链二次提取（深度跳转）
// 当 feed.videoExtract 为 true 时，对每条目按 tpl.link 抓取详情页，
// 再从详情页提取真实视频地址，回填到 row._video / row._poster。
// 详情页只解析初始 HTML（og:video / JSON-LD / <video>），不启动 Puppeteer，
// 因此比列表页快很多；若详情页是 JS 渲染的，可在 feed.videoRule 里写规则。
// ============================================================

// 并发受限的 map（避免一次性发起几十个请求打爆源站/触发限流）
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const cur = idx++;
            results[cur] = await fn(items[cur], cur);
        }
    }
    const n = Math.max(1, Math.min(limit, items.length));
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
}

// 详情页抓取：绝不启动 Puppeteer（只取初始 HTML 里的 meta/jsonld，速度远快于渲染）
function fetchDetailPage(targetUrl, proxyConfig) {
    if (proxyConfig && typeof proxyConfig === 'string' && proxyConfig.length > 0) {
        return fetchWithProxy(targetUrl, 0, proxyConfig);
    }
    return fetchDirect(targetUrl, 0);
}

// 自动识别视频地址（无需用户写规则）：og:video → JSON-LD → <video>/<source>
function extractVideoAuto(html) {
    let video = pickMeta(html, ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']);
    let poster = pickMeta(html, ['og:image:secure_url', 'og:image:url', 'og:image']);
    if (!video) {
        const ld = extractJsonLdVideo(html);
        if (ld) { video = video || ld.video; poster = poster || ld.poster; }
    }
    if (!video) {
        const m = html.match(/<video[^>]*\ssrc=["']([^"']+)["']/i) || html.match(/<source[^>]*\ssrc=["']([^"']+)["']/i);
        if (m) video = m[1];
        const pm = html.match(/<video[^>]*\sposter=["']([^"']+)["']/i);
        if (pm) poster = pm[1];
    }
    if (video) video = decodeHtmlEntities(video.trim());
    if (poster) poster = decodeHtmlEntities(poster.trim());
    return { video: video || null, poster: poster || null };
}

// 读取 <meta property|name="x" content="y">（兼容两种属性书写顺序）
function pickMeta(html, props) {
    for (const p of props) {
        const m1 = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*\\scontent=["']([^"']+)["']`, 'i'));
        if (m1 && m1[1]) return m1[1];
        const m2 = html.match(new RegExp(`<meta[^>]+\\scontent=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i'));
        if (m2 && m2[1]) return m2[1];
    }
    return null;
}

// 解析 JSON-LD 中的 VideoObject
function extractJsonLdVideo(html) {
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        try {
            const data = JSON.parse(m[1]);
            const found = findVideoInJsonLd(data);
            if (found) return found;
        } catch (e) { /* ignore parse error */ }
    }
    return null;
}
function findVideoInJsonLd(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) { for (const it of obj) { const r = findVideoInJsonLd(it); if (r) return r; } return null; }
    if (obj['@graph']) { const r = findVideoInJsonLd(obj['@graph']); if (r) return r; }
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.includes('VideoObject') && obj.contentUrl) {
        return { video: obj.contentUrl, poster: obj.thumbnailUrl || obj.thumbnail || null };
    }
    for (const k of Object.keys(obj)) {
        const r = findVideoInJsonLd(obj[k]);
        if (r) return r;
    }
    return null;
}

// 解析 JSON-LD 中“所有” VideoObject
function extractJsonLdVideos(html) {
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        try { const data = JSON.parse(m[1]); findAllVideosInJsonLd(data, out); } catch (e) {}
    }
    return out;
}
function findAllVideosInJsonLd(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(it => findAllVideosInJsonLd(it, out)); return; }
    if (obj['@graph']) findAllVideosInJsonLd(obj['@graph'], out);
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.includes('VideoObject') && obj.contentUrl) {
        out.push({ video: obj.contentUrl, poster: obj.thumbnailUrl || obj.thumbnail || null });
    }
    for (const k of Object.keys(obj)) findAllVideosInJsonLd(obj[k], out);
}

// 自动识别“所有”视频地址（og:video / JSON-LD / <video>/<source>），用于“全部(enclosure)”模式
function extractVideoAutoAll(html) {
    const out = [];
    const ogv = pickMeta(html, ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']);
    const ogp = pickMeta(html, ['og:image:secure_url', 'og:image:url', 'og:image']);
    if (ogv) out.push({ video: ogv, poster: ogp });
    extractJsonLdVideos(html).forEach(v => out.push(v));
    const videoTags = html.match(/<video\b[^>]*>/gi) || [];
    videoTags.forEach(tag => {
        const src = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1];
        const poster = (tag.match(/\sposter=["']([^"']+)["']/i) || [])[1];
        if (src) out.push({ video: src, poster: poster || null });
    });
    const sourceTags = html.match(/<source\b[^>]*>/gi) || [];
    sourceTags.forEach(tag => {
        const src = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1];
        if (src) out.push({ video: src, poster: null });
    });
    const seen = new Set();
    const cleaned = [];
    for (const o of out) {
        if (!o.video) continue;
        const k = o.video.trim();
        if (seen.has(k)) continue;
        seen.add(k);
        cleaned.push({ video: decodeHtmlEntities(k), poster: o.poster ? decodeHtmlEntities(o.poster.trim()) : null });
    }
    return cleaned;
}

// 自动识别“所有”图片地址（og:image / JSON-LD / <img>）
function extractImagesAuto(html) {
    const out = [];
    const ogp = pickMeta(html, ['og:image:secure_url', 'og:image:url', 'og:image']);
    if (ogp) out.push(ogp);
    extractJsonLdImages(html).forEach(u => out.push(u));
    const imgTags = html.match(/<img\b[^>]*>/gi) || [];
    imgTags.forEach(tag => {
        const src = (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1];
        if (src) out.push(src);
    });
    const seen = new Set();
    const cleaned = [];
    for (const u of out) {
        const k = (u || '').trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        cleaned.push(decodeHtmlEntities(k));
    }
    return cleaned;
}
function extractJsonLdImages(html) {
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        try { const data = JSON.parse(m[1]); findAllImagesInJsonLd(data, out); } catch (e) {}
    }
    return out;
}
function findAllImagesInJsonLd(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(it => findAllImagesInJsonLd(it, out)); return; }
    if (obj['@graph']) findAllImagesInJsonLd(obj['@graph'], out);
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.includes('ImageObject') && obj.contentUrl) out.push(obj.contentUrl);
    ['image', 'thumbnailUrl', 'contentUrl'].forEach(k => {
        const v = obj[k];
        if (typeof v === 'string' && /^https?:\/\//.test(v)) out.push(v);
    });
    for (const k of Object.keys(obj)) findAllImagesInJsonLd(obj[k], out);
}

// HEAD 请求拿 Content-Length（用于“取文件最大”策略）
function headContentLength(u) {
    return new Promise((resolve) => {
        const ctrl = setTimeout(() => resolve(0), 4000);
        try {
            const parsed = new URL(u);
            const client = parsed.protocol === 'https:' ? https : http;
            const req = client.request({
                method: 'HEAD',
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers: { 'User-Agent': DEFAULT_USER_AGENT },
            }, (res) => {
                clearTimeout(ctrl);
                const len = parseInt(res.headers['content-length'] || '0', 10);
                resolve(len || 0);
                res.resume();
            });
            req.on('error', () => { clearTimeout(ctrl); resolve(0); });
            req.setTimeout(4000, () => { req.destroy(); resolve(0); });
            req.end();
        } catch (e) { clearTimeout(ctrl); resolve(0); }
    });
}
async function pickLargestVideo(videos) {
    if (videos.length <= 1) return videos[0] || null;
    const scored = await Promise.all(videos.map(async (v) => {
        const len = await headContentLength(v.video);
        return { v, len: len || 0 };
    }));
    scored.sort((a, b) => b.len - a.len);
    return scored[0].v;
}

// 主流程：给提取结果补充视频/图片直链（二次抓取）
async function enrichWithVideoLinks(rows, ctx) {
    const { url, tpl, options, proxy, feed } = ctx;
    const max = Math.min(rows.length, feed.deepExtractMax || 12);
    const budgetMs = 45000; // 单次构建总预算，避免详情页过多拖垮 60s 超时
    // 详情页地址：默认用条目链接模板，可在 feed.videoUrlTpl 覆盖（例如列表链接与视频页不是同一地址时）
    const detailTpl = (feed.videoUrlTpl && feed.videoUrlTpl.trim()) ? feed.videoUrlTpl.trim() : (tpl.link || '{%2}');
    const videoSelect = feed.videoSelect || 'first'; // first | largest | all
    const start = Date.now();
    const slice = rows.slice(0, max);
    await mapWithConcurrency(slice, 4, async (row) => {
        if (Date.now() - start > budgetMs) return;
        try {
            const detailLink = applyTemplate(detailTpl, row);
            if (!detailLink) return;
            let absUrl;
            try { absUrl = new URL(detailLink, url).href; } catch (e) { return; }
            const detailHtml = await withTimeout(fetchDetailPage(absUrl, proxy), 15000, '详情页抓取超时');

            // ---- 视频 ----
            let videos = [];
            if (feed.videoRule && feed.videoRule.trim()) {
                const vr = extractWithRule(detailHtml, feed.videoRule, options);
                videos = vr.map(r => ({ video: r[0], poster: r[1] || null })).filter(v => v.video);
            } else {
                videos = extractVideoAutoAll(detailHtml);
            }
            videos = videos.map(v => {
                try { v.video = new URL(v.video, absUrl).href; if (v.poster) v.poster = new URL(v.poster, absUrl).href; } catch (e) {}
                return v;
            }).filter(v => !!v.video);

            if (videos.length) {
                let chosen;
                if (videoSelect === 'all') chosen = videos;
                else if (videoSelect === 'largest') chosen = [await pickLargestVideo(videos)];
                else chosen = [videos[0]];
                row._videos = chosen;
                row._video = chosen[0].video;     // 兼容 {video} 令牌
                row._poster = chosen[0].poster;   // 兼容 {poster} 令牌
            }

            // ---- 图片（多张） ----
            let images = [];
            if (feed.imageRule && feed.imageRule.trim()) {
                const ir = extractWithRule(detailHtml, feed.imageRule, options);
                images = ir.map(r => r[0]).filter(Boolean);
            } else {
                images = extractImagesAuto(detailHtml);
            }
            // 去重，避免重复 <enclosure>
            const seenImg = new Set();
            images = images.filter(u => { const k = (u || '').trim(); if (!k || seenImg.has(k)) return false; seenImg.add(k); return true; });
            images = images.map(u => { try { return new URL(u, absUrl).href; } catch (e) { return u; } }).filter(Boolean);
            if (images.length) row._images = images;

        } catch (e) {
            console.warn(`  二次提取失败（该条目跳过）: ${e.message}`);
        }
    });
    const gotV = rows.filter(r => r._video).length;
    const gotI = rows.filter(r => r._images && r._images.length).length;
    console.log(`  二次提取完成: 视频 ${gotV}/${max} 条, 图片 ${gotI}/${max} 条`);
}

// 模板特殊令牌：{video} / {poster} / {images}（仅在启用了二次提取时有值）
function applySpecialTokens(str, row) {
    if (!str) return str;
    const video = (row && row._video) || '';
    const poster = (row && row._poster) || '';
    const images = (row && row._images && row._images.length) ? row._images : [];
    const imagesHtml = images.map(u => `<img src="${u}" style="max-width:100%;margin:6px 0;border-radius:6px;" />`).join('\n');
    return str
        .replace(/\{video\}/g, video)
        .replace(/\{poster\}/g, poster)
        .replace(/\{images\}/g, imagesHtml);
}

// 根据扩展名猜测 MIME（用于 enclosure type）
function guessMime(u) {
    const lower = (u.split('?')[0] || '').toLowerCase();
    if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (lower.endsWith('.mpd')) return 'application/dash+xml';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    return 'video/mp4';
}

// 根据扩展名猜测图片 MIME（用于图片 <enclosure> 的 type）
function guessImageMime(u) {
    const lower = (u.split('?')[0] || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.avif')) return 'image/avif';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    return 'image/jpeg';
}

// ============================================================
// 构建 RSS XML
// ============================================================
function buildRssXml({ title, description, link, language, items, tpl, baseUrl, videoEmbed = false }) {
    const now = new Date().toUTCString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
    xml += '<channel>\n';
    // title 和 description 使用转义方式（更兼容阅读器），description 如果内容复杂可改用 CDATA
    xml += `  <title>${escapeXml(title)}</title>\n`;
    xml += `  <link>${escapeXml(link)}</link>\n`;
    xml += `  <description>${escapeXml(description)}</description>\n`;
    xml += `  <lastBuildDate>${now}</lastBuildDate>\n`;
    xml += `  <generator>RSS-Builder/2.0 (Node.js)</generator>\n`;
    xml += `  <language>${language}</language>\n`;

    items.forEach((row, index) => {
        let itemTitle = applySpecialTokens(applyTemplate(tpl.title || '{%1}', row), row);
        let itemLink = applySpecialTokens(applyTemplate(tpl.link || '{%2}', row), row);
        let itemContent = applySpecialTokens(applyTemplate(tpl.content || '{%3}', row), row);

        const videos = (row._videos && row._videos.length) ? row._videos : null;
        const images = (row._images && row._images.length) ? row._images : null;

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
        // title 使用转义方式，兼容性更好
        xml += `    <title>${escapeXml(itemTitle)}</title>\n`;
        xml += `    <link>${escapeXml(itemLink)}</link>\n`;
        // 视频直链：一个或多个 <enclosure>（播客/阅读器可直接识别并播放），必须位于 <item> 内部
        if (videos) {
            videos.forEach(v => {
                xml += `    <enclosure url="${escapeXml(v.video)}" type="${guessMime(v.video)}" />\n`;
            });
            // 可选：在内容中内嵌 <video> 播放器（仅内嵌第一个）
            if (videoEmbed && videos[0]) {
                itemContent += `\n<video src="${escapeXml(videos[0].video)}"${videos[0].poster ? ` poster="${escapeXml(videos[0].poster)}"` : ''} controls playsinline preload="metadata"></video>`;
            }
        }
        // 图片直链：每张一个 <enclosure>，便于阅读器/Hugo 等聚合
        if (images) {
            images.forEach(img => {
                xml += `    <enclosure url="${escapeXml(img)}" type="${guessImageMime(img)}" />\n`;
            });
        }
        // description（内容）使用 CDATA，因为可能包含 HTML
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
// Promise 超时包装
// ============================================================
function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(message));
        }, ms);
        promise.then((result) => {
            clearTimeout(timer);
            resolve(result);
        }).catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// ============================================================
// 复制在线生成器到输出目录
// ============================================================
function copyRssBuilder() {
    // 优先找 rss-builder.html，找不到则回退到 index.html
    const candidates = ['rss-builder.html', 'index.html'];
    let copied = false;

    for (const filename of candidates) {
        const sourceFile = path.join(__dirname, filename);
        if (fs.existsSync(sourceFile)) {
            const targetFile = path.join(OUTPUT_DIR, 'rss-builder.html');
            fs.copyFileSync(sourceFile, targetFile);
            console.log(`✓ 在线生成器已复制: ${filename} → rss-builder.html`);
            copied = true;
            break;
        }
    }

    if (!copied) {
        console.warn('⚠ 未找到 rss-builder.html 或 index.html，跳过复制在线生成器');
    }
}

// ============================================================
// 启动
// ============================================================
// 作为模块被 require 时导出内部函数（便于单元测试），且不自动运行 main
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractVideoAuto,
        extractVideoAutoAll,
        extractImagesAuto,
        pickMeta,
        extractJsonLdVideo,
        guessMime,
        guessImageMime,
        applySpecialTokens,
        extractWithRule,
        enrichWithVideoLinks,
        applyTemplate,
        buildRssXml,
    };
}

// 仅在直接运行（node generate.js）时执行主流程
if (require.main === module) {
    main().catch(err => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}

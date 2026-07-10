/**
 * RSS Builder - Cloudflare Worker 代理
 * 
 * 功能：
 * 1. /fetch?url=xxx — 代理抓取任意网页，绕过 CORS 和 IP 封禁
 * 2. /save — 保存 sources.json 到 GitHub 仓库
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard → Workers & Pages → 创建应用程序 → 创建 Worker
 * 2. 给 Worker 取个名字（如 rss-builder-proxy）
 * 3. 把这个文件的全部内容粘贴到编辑器中
 * 4. 点击"保存并部署"
 * 5. 记下 Worker 的地址：https://rss-builder-proxy.你的子域.workers.dev
 */

// ============================================================
// 配置（修改这里）
// ============================================================
const GITHUB_TOKEN = '在这里填入你的GitHub Personal Access Token';
const GITHUB_REPO = 'hanyee2023/rss-builder';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}`;

// ============================================================
// 主路由
// ============================================================
export default {
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS 预检请求
        if (request.method === 'OPTIONS') {
            return handleCors();
        }

        try {
            if (path === '/fetch' && url.searchParams.has('url')) {
                return handleFetch(url.searchParams.get('url'));
            }

            if (path === '/save' && request.method === 'POST') {
                return handleSave(request);
            }

            if (path === '/trigger' && request.method === 'POST') {
                return handleTrigger();
            }

            return new Response(JSON.stringify({
                name: 'RSS Builder Proxy',
                version: '1.0',
                endpoints: {
                    '/fetch?url=xxx': '代理抓取网页',
                    '/save': 'POST 保存 sources.json 到 GitHub',
                    '/trigger': 'POST 触发 GitHub Actions 运行',
                },
            }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            });
        }
    }
};

// ============================================================
// 代理抓取网页
// ============================================================
async function handleFetch(targetUrl) {
    if (!targetUrl) {
        return new Response(JSON.stringify({ error: '缺少 url 参数' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    const start = Date.now();

    const response = await fetch(targetUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        },
        redirect: 'follow',
    });

    const html = await response.text();
    const elapsed = Date.now() - start;

    return new Response(JSON.stringify({
        success: true,
        status: response.status,
        url: response.url, // 最终 URL（可能有重定向）
        length: html.length,
        elapsed: `${elapsed}ms`,
        html: html,
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

// ============================================================
// 保存 sources.json 到 GitHub
// ============================================================
async function handleSave(request) {
    if (!GITHUB_TOKEN || GITHUB_TOKEN === '在这里填入你的GitHub Personal Access Token') {
        return new Response(JSON.stringify({
            error: '未配置 GITHUB_TOKEN，请在 Worker 代码中填写你的 GitHub Personal Access Token',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    const body = await request.json();
    const { content, message } = body;

    if (!content) {
        return new Response(JSON.stringify({ error: '缺少 content 字段' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    // 先获取当前文件 SHA（用于更新）
    let sha = null;
    try {
        const existing = await fetch(`${GITHUB_API}/contents/sources.json`, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'RSS-Builder-Worker',
            },
        });
        if (existing.ok) {
            const data = await existing.json();
            sha = data.sha;
        }
    } catch (e) {
        // 文件不存在，忽略
    }

    // 创建或更新文件
    const commitMsg = message || `update sources.json - ${new Date().toISOString()}`;
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const putBody = {
        message: commitMsg,
        content: base64Content,
        sha: sha,
    };

    const result = await fetch(`${GITHUB_API}/contents/sources.json`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'RSS-Builder-Worker',
        },
        body: JSON.stringify(putBody),
    });

    const resultData = await result.json();

    if (!result.ok) {
        return new Response(JSON.stringify({
            error: resultData.message || 'GitHub API 错误',
            details: resultData,
        }), {
            status: result.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    return new Response(JSON.stringify({
        success: true,
        commit: {
            sha: resultData.commit.sha,
            url: resultData.commit.html_url,
            message: resultData.commit.message,
        },
        content: {
            path: resultData.content.path,
            size: resultData.content.size,
        },
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

// ============================================================
// 触发 GitHub Actions
// ============================================================
async function handleTrigger() {
    if (!GITHUB_TOKEN || GITHUB_TOKEN === '在这里填入你的GitHub Personal Access Token') {
        return new Response(JSON.stringify({ error: '未配置 GITHUB_TOKEN' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    const result = await fetch(`${GITHUB_API}/actions/workflows/update-rss.yml/dispatches`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'RSS-Builder-Worker',
        },
        body: JSON.stringify({ ref: 'main' }),
    });

    if (!result.ok) {
        const errorData = await result.json().catch(() => ({}));
        return new Response(JSON.stringify({
            error: '触发 Actions 失败',
            details: errorData,
        }), {
            status: result.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    }

    return new Response(JSON.stringify({
        success: true,
        message: 'GitHub Actions 已触发，RSS 将在 1-2 分钟内更新',
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

// ============================================================
// CORS 处理
// ============================================================
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function handleCors() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(),
    });
}

/**
 * RSS Builder - Cloudflare Worker（轻量版）
 * 
 * 只做两件事：
 * 1. /save — 保存 sources.json 到 GitHub 仓库
 * 2. /trigger — 触发 GitHub Actions 运行
 * 
 * 部署方法（网页操作，不需要本地环境）：
 * 1. 登录 Cloudflare Dashboard → Workers & Pages → 创建应用程序 → 创建 Worker
 * 2. 给 Worker 取个名字（如 rss-proxy）
 * 3. 把这个文件的全部内容粘贴到编辑器中
 * 4. 修改下面 GITHUB_TOKEN 为你的 GitHub Personal Access Token
 * 5. 点击"保存并部署"
 * 6. 记下地址：https://rss-proxy.你的子域.workers.dev
 */

const GITHUB_TOKEN = '在这里填入你的GitHub Personal Access Token';
const GITHUB_REPO = 'hanyee2023/rss-builder';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}`;

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        try {
            if (path === '/save' && request.method === 'POST') {
                return handleSave(await request.json());
            }
            if (path === '/delete' && request.method === 'POST') {
                return handleDelete(await request.json());
            }
            if (path === '/trigger' && request.method === 'POST') {
                return handleTrigger();
            }

            return new Response(JSON.stringify({
                name: 'RSS Builder Proxy',
                version: '1.0',
                status: 'ok',
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }
    }
};

async function handleDelete(body) {
    if (!GITHUB_TOKEN || GITHUB_TOKEN === '在这里填入你的GitHub Personal Access Token') {
        return json({ error: '未配置 GITHUB_TOKEN' }, 500);
    }
    if (!body.feedId) {
        return json({ error: '缺少 feedId' }, 400);
    }

    // 获取当前 sources.json
    const res = await fetch(`${GITHUB_API}/contents/sources.json`, { headers: ghHeaders() });
    if (!res.ok) return json({ error: '无法读取 sources.json' }, res.status);
    const data = await res.json();
    let content = atob(data.content);
    const sources = JSON.parse(content);

    if (!sources.feeds || !Array.isArray(sources.feeds)) {
        return json({ error: 'sources.json 格式错误' }, 400);
    }

    // 删除指定订阅源
    const before = sources.feeds.length;
    sources.feeds = sources.feeds.filter(f => f.id !== body.feedId);
    const after = sources.feeds.length;

    if (before === after) {
        return json({ error: `未找到订阅源「${body.feedId}」` }, 404);
    }

    // 写回
    const result = await fetch(`${GITHUB_API}/contents/sources.json`, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
            message: `delete feed ${body.feedId} - ${new Date().toISOString().slice(0,16)}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(sources, null, 2)))),
            sha: data.sha,
        }),
    });
    const putData = await result.json();
    if (!result.ok) return json({ error: putData.message || '删除失败', details: putData }, result.status);
    return json({ success: true, message: `已删除订阅源「${body.feedId}」` });
}

async function handleSave(body) {
    if (!GITHUB_TOKEN || GITHUB_TOKEN === '在这里填入你的GitHub Personal Access Token') {
        return json({ error: '未配置 GITHUB_TOKEN，请修改 Worker 代码顶部的 Token' }, 500);
    }
    if (!body.content) {
        return json({ error: '缺少 content' }, 400);
    }

    // 获取当前文件 SHA
    let sha = null;
    try {
        const res = await fetch(`${GITHUB_API}/contents/sources.json`, {
            headers: ghHeaders(),
        });
        if (res.ok) sha = (await res.json()).sha;
    } catch (e) {}

    const result = await fetch(`${GITHUB_API}/contents/sources.json`, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
            message: body.message || `update sources.json - ${new Date().toISOString().slice(0,16)}`,
            content: btoa(unescape(encodeURIComponent(body.content))),
            sha: sha,
        }),
    });
    const data = await result.json();

    if (!result.ok) return json({ error: data.message || 'GitHub API 错误', details: data }, result.status);
    return json({ success: true, commit: data.commit.html_url });
}

async function handleTrigger() {
    if (!GITHUB_TOKEN || GITHUB_TOKEN === '在这里填入你的GitHub Personal Access Token') {
        return json({ error: '未配置 GITHUB_TOKEN' }, 500);
    }
    const result = await fetch(`${GITHUB_API}/actions/workflows/update-rss.yml/dispatches`, {
        method: 'POST',
        headers: ghHeaders(),
        body: JSON.stringify({ ref: 'main' }),
    });
    if (!result.ok) {
        const data = await result.json().catch(() => ({}));
        return json({ error: '触发失败', details: data }, result.status);
    }
    return json({ success: true, message: 'Actions 已触发，RSS 将在 1-2 分钟后更新' });
}

function ghHeaders() {
    return {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'RSS-Builder-Proxy',
    };
}
function corsHeaders() {
    return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

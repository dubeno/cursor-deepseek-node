require('dotenv').config();
const http = require('http');
const http2 = require('http2');
const { PassThrough } = require('stream');
const { Buffer } = require('buffer');

// 环境配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com';
const GPT4O_MODEL = 'gpt-4o';
const DEEPSEEK_MODEL = 'deepseek-chat';
const PORT_HTTP = process.env.PORT_HTTP || 9001;
const PORT_HTTP2 = process.env.PORT_HTTP2 || 9000;

// 验证环境变量
if (!DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY is required');
    process.exit(1);
}

// 创建服务器实例
const httpServer = http.createServer(handleRequest);
const http2Server = http2.createSecureServer({
    allowHTTP1: true // 允许HTTP/1.1回退
}, handleRequest);

// 统一请求处理器
async function handleRequest(req, res) {
    try {
        handleCORS(req, res);
        if (req.method === 'OPTIONS') return res.end();

        if (req.url === '/v1/models') {
            return sendModels(res);
        }

        const { body, isStream } = await parseRequest(req);
        validateModel(body.model);
        
        const processedReq = processRequest(body);
        const deepseekRes = await forwardRequest(req, processedReq);
        
        handleProxyResponse(res, deepseekRes, isStream);
    } catch (err) {
        handleError(res, err);
    }
}

// ================ 核心功能函数 ================

// CORS处理
function handleCORS(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

// 模型列表响应
function sendModels(res) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
        object: 'list',
        data: [
            createModelEntry(GPT4O_MODEL, 'openai'),
            createModelEntry(DEEPSEEK_MODEL, 'deepseek')
        ]
    }));
}

function createModelEntry(id, owner) {
    return {
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: owner
    };
}

// 请求解析
async function parseRequest(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                resolve({
                    body,
                    isStream: body.stream === true
                });
            } catch {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

// 请求验证
function validateModel(model) {
    if (!model) throw new Error('Missing model parameter');
    if (model !== GPT4O_MODEL) {
        throw new Error(`Unsupported model: ${model}`);
    }
}

// 请求处理
function processRequest(body) {
    const processed = {
        ...body,
        model: DEEPSEEK_MODEL,
        messages: convertMessages(body.messages || []),
        tools: convertTools(body)
    };

    if (body.tool_choice) {
        processed.tool_choice = convertToolChoice(body.tool_choice);
    }

    return processed;
}

// 消息格式转换
function convertMessages(messages) {
    return messages.map(msg => ({
        role: msg.role === 'function' ? 'tool' : msg.role,
        content: msg.content,
        tool_calls: msg.tool_calls?.map(tc => ({
            id: tc.id,
            type: 'function',
            function: tc.function
        }))
    }));
}

// 工具转换
function convertTools(body) {
    if (body.functions?.length > 0) {
        return body.functions.map(fn => ({
            type: 'function',
            function: fn
        }));
    }
    return body.tools;
}

function convertToolChoice(choice) {
    if (typeof choice === 'string') {
        return ['auto', 'none'].includes(choice) ? choice : 'auto';
    }
    return choice?.type === 'function' ? 'auto' : '';
}

// 请求转发
async function forwardRequest(originalReq, body) {
    const client = http2.connect(DEEPSEEK_ENDPOINT);
    const req = client.request({
        ':path': originalReq.url,
        ':method': originalReq.method,
        'authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'content-type': 'application/json',
        'accept': body.stream ? 'text/event-stream' : 'application/json'
    });

    const proxyStream = new PassThrough({ highWaterMark: 1024 * 1024 }); // 1MB缓冲

    return new Promise((resolve, reject) => {
        req.write(JSON.stringify(body));
        req.end();

        req.on('response', headers => {
            resolve({
                status: headers[':status'],
                headers: filterPseudoHeaders(headers),
                stream: proxyStream
            });
        });

        req.pipe(proxyStream);
        
        req.on('error', err => {
            proxyStream.destroy(err);
            client.close();
            reject(err);
        });

        proxyStream.on('end', () => client.close());
    });
}

function filterPseudoHeaders(headers) {
    return Object.entries(headers).reduce((acc, [key, value]) => {
        if (!key.startsWith(':')) acc[key] = value;
        return acc;
    }, {});
}

// 响应处理
function handleProxyResponse(res, deepseekRes, isStream) {
    res.writeHead(deepseekRes.status || 500, deepseekRes.headers);

    if (isStream) {
        handleStreamingResponse(res, deepseekRes.stream);
    } else {
        handleRegularResponse(res, deepseekRes.stream);
    }
}

// 流式响应处理
function handleStreamingResponse(res, stream) {
    stream.pipe(res);
    
    res.on('close', () => {
        stream.destroy();
        console.log('Client disconnected');
    });

    stream.on('error', err => {
        console.error('Stream error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
    });
}

// 常规响应处理
function handleRegularResponse(res, stream) {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
        try {
            const response = JSON.parse(Buffer.concat(chunks).toString());
            response.model = GPT4O_MODEL;
            res.end(JSON.stringify(response));
        } catch (err) {
            handleError(res, new Error('Response parse failed'));
        }
    });
}

// 错误处理
function handleError(res, err) {
    console.error('Error:', err.message);
    const statusCode = err.statusCode || 500;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: {
            code: statusCode,
            message: err.message
        }
    }));
}

// ================ 启动服务 ================
httpServer.listen(PORT_HTTP, () => {
    console.log(`HTTP/1.1 server running on port ${PORT_HTTP}`);
});

http2Server.listen(PORT_HTTP2, () => {
    console.log(`HTTP/2 server running on port ${PORT_HTTP2}`);
});

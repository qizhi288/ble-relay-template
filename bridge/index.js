import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const toyQueue = {
  command: null,
  timestamp: 0,
  secret: process.env.BRIDGE_SECRET || '123456'
};

// ===== 健康检查 =====
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// ===== 接收指令（HTTP / MCP 调用） =====
app.post('/toy', (req, res) => {
  const { secret, action, value } = req.body;

  // 密码验证已注释（糯叽叽不需要密码）
  // if (secret !== toyQueue.secret) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  // 不管什么 action，都存到队列里
  toyQueue.command = { action, value: value || 0, received: Date.now() };
  toyQueue.timestamp = Date.now();
  console.log(`📥 收到指令: ${action} = ${value}`);
  res.json({ status: 'ok', command: toyQueue.command });
});

// ===== 网页中继轮询 =====
app.get('/toy-next', (req, res) => {
 console.log("🔄 收到轮询请求"); 
  const { secret } = req.query;

  if (secret !== toyQueue.secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const age = Date.now() - toyQueue.timestamp;
  if (age > 5000) {
    return res.json({ command: null });
  }

  const cmd = toyQueue.command;
  toyQueue.command = null;
  console.log(`📤 中继取走: ${cmd?.action} = ${cmd?.value}`);
  res.json({ command: cmd });
});

// ===== 状态查询 =====
app.get('/status', (req, res) => {
  res.json({
    hasCommand: toyQueue.command !== null,
    age: Date.now() - toyQueue.timestamp
  });
});

// ===== 糯叽叽 MCP 入口 =====
app.post('/', (req, res) => {
  console.log('📥 MCP 请求:', JSON.stringify(req.body, null, 2));

  const { jsonrpc, id, method, params } = req.body;

  // initialize
  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'svakom-bridge', version: '1.0.0' }
      }
    });
  }

  // tools/list
  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id: id,
      result: {
        tools: [
{
  name: 'toy_set_speed',
  description: '真实蓝牙设备控制工具。调用后会改变设备强度。需要改变设备状态时必须使用此工具。value范围0-100。',
  inputSchema: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: '目标强度百分比，0表示关闭，100表示最大强度。',
        minimum: 0,
        maximum: 100
      }
    },
    required: ['value']
  }
},
{
  name: 'toy_stop',
  description: '真实蓝牙设备控制工具。调用后会立即停止设备动作。',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}
        ]
      }
    });
  }

  // tools/call
  if (method === 'tools/call') {
    try {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === 'toy_set_speed') {
        const val = typeof args.value === 'number' ? args.value : 0;
        toyQueue.command = { action: 'intensity', value: val, received: Date.now() };
        toyQueue.timestamp = Date.now();
        console.log(`📥 存入队列: 强度 ${val}%`);
        return res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: `✅ 强度设为 ${val}%` }]
          }
        });
      }

      if (toolName === 'toy_stop') {
        toyQueue.command = { action: 'stop', value: 0, received: Date.now() };
        toyQueue.timestamp = Date.now();
        console.log(`📥 存入队列: 停止`);
        return res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: '✅ 已停止' }]
          }
        });
      }

      return res.json({
        jsonrpc: '2.0',
        id: id,
        error: { code: -32601, message: `未知工具: ${toolName}` }
      });
    } catch (e) {
      console.error('MCP tools/call 出错:', e);
      return res.json({
        jsonrpc: '2.0',
        id: id,
        error: { code: -32603, message: 'Internal Server Error' }
      });
    }
  }

  res.json({ jsonrpc: '2.0', id: id, result: {} });
});

// 队列执行器
setInterval(async () => {
  if (!toyQueue.command) return;

  const cmd = toyQueue.command;

  console.log('🚀 执行设备命令:', cmd);

  if (cmd.action === 'intensity') {
    await setSvakomSpeed(cmd.value);
  }

  if (cmd.action === 'stop') {
    await stopSvakom();
  }

  // 执行完清空
  toyQueue.command = null;

}, 500);


// 临时测试函数
async function setSvakomSpeed(value) {
  console.log(`🔵 蓝牙设置强度: ${value}%`);
}


async function stopSvakom() {
  console.log('🔴 蓝牙停止');
}


app.listen(PORT, () => {
  console.log(`🚀 服务运行在端口 ${PORT}`);
});

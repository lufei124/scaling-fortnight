const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// 创建数据库
const db = new sqlite3(path.join(__dirname, 'prompts.db'));

// 初始化数据库
db.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TRIGGER IF NOT EXISTS update_prompts_timestamp
  AFTER UPDATE ON prompts
  FOR EACH ROW
  BEGIN
    UPDATE prompts SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END;
`);

// 添加示例数据
const rowCount = db.prepare('SELECT COUNT(*) AS count FROM prompts').get().count;
if (rowCount === 0) {
  const insert = db.prepare(`
    INSERT INTO prompts (title, content, category) 
    VALUES (?, ?, ?)
  `);
  
  insert.run('翻译助手', '将以下英文翻译成中文：', '工具');
  insert.run('写作助手', '请帮助我写一篇关于{主题}的文章，要求：', '创作');
  insert.run('代码助手', '请解释以下代码的功能：', '开发');
  
  console.log('添加了初始示例数据');
}

// 中间件
app.use(bodyParser.json());
app.use(express.static('public'));

// 跨域支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// API路由

// 获取所有提示词
app.get('/api/prompts', (req, res) => {
  try {
    const prompts = db.prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all();
    res.json(prompts);
  } catch (err) {
    res.status(500).json({ error: '数据库查询失败' });
  }
});

// 获取所有分类
app.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT DISTINCT category FROM prompts').all();
    res.json(categories.map(c => c.category));
  } catch (err) {
    res.status(500).json({ error: '数据库查询失败' });
  }
});

// 创建新提示词
app.post('/api/prompts', (req, res) => {
  const { title, content, category } = req.body;
  
  if (!title || !content) {
    return res.status(400).json({ error: '标题和内容不能为空' });
  }
  
  try {
    const result = db.prepare(`
      INSERT INTO prompts (title, content, category) 
      VALUES (?, ?, ?)
    `).run(title, content, category || 'General');
    
    const newPrompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(result.lastInsertRowid);
    
    // 广播新提示词
    broadcast({ type: 'prompt_created', data: newPrompt });
    
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: '创建提示词失败' });
  }
});

// 批量导入提示词
app.post('/api/prompts/import', (req, res) => {
  const newPrompts = req.body;
  
  if (!Array.isArray(newPrompts))  {
    return res.status(400).json({ error: '无效的数据格式' });
  }
  
  try {
    const insert = db.prepare(`
      INSERT INTO prompts (title, content, category) 
      VALUES (?, ?, ?)
    `);
    
    const insertMany = db.transaction((prompts) => {
      for (const prompt of prompts) {
        insert.run(prompt.title, prompt.content, prompt.category || 'General');
      }
    });
    
    insertMany(newPrompts);
    
    // 广播导入完成
    broadcast({ type: 'prompts_imported', data: { count: newPrompts.length } });
    
    res.json({ success: true, count: newPrompts.length });
  } catch (err) {
    res.status(500).json({ error: '导入提示词失败' });
  }
});

// 更新提示词
app.put('/api/prompts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { title, content, category } = req.body;
  
  try {
    const update = db.prepare(`
      UPDATE prompts 
      SET title = ?, content = ?, category = ?
      WHERE id = ?
    `).run(title, content, category, id);
    
    if (update.changes === 0) {
      return res.status(404).json({ error: '提示词未找到' });
    }
    
    const updatedPrompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
    
    // 广播更新
    broadcast({ type: 'prompt_updated', data: updatedPrompt });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新提示词失败' });
  }
});

// 删除提示词
app.delete('/api/prompts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  try {
    db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    
    // 广播删除
    broadcast({ type: 'prompt_deleted', data: { id } });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除提示词失败' });
  }
});

// 启动Express服务器
const server = app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

// WebSocket服务器
const wss = new WebSocket.Server({ server });

// 广播消息给所有客户端
function broadcast(message) {
  const messageString = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageString);
    }
  });
}

// 客户端管理
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WebSocket客户端已连接 (总数: ${clients.size})`);
  
  // 发送当前提示词列表给新客户端
  const prompts = db.prepare('SELECT * FROM prompts').all();
  ws.send(JSON.stringify({
    type: 'initial_data',
    data: prompts
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket客户端断开连接 (总数: ${clients.size})`);
  });
  
  // 心跳检测
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// 心跳检测
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('客户端无响应，终止连接');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping(null, false, true);
  });
}, 30000);

// 清理
wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 处理错误
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的拒绝:', promise, '原因:', reason);
});
// db.js - 使用 better-sqlite3
const Database = require('better-sqlite3');

class DB {
  constructor() {
    // 数据库文件将创建在项目根目录下
    this.db = new Database('prompts.db');
    this.initialize();
  }

  initialize() {
    // 创建提示词表
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    console.log('Database initialized');
  }

  all(query, params = []) {
    return this.db.prepare(query).all(params);
  }

  run(query, params = []) {
    return this.db.prepare(query).run(params);
  }

  get(query, params = []) {
    return this.db.prepare(query).get(params);
  }
}

// 导出单例实例
module.exports = new DB();
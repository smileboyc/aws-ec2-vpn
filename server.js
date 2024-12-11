require('dotenv').config();  // 加载 .env 文件
const express = require('express');
const connectVPN = require('./connectVPN');  // 导入路由模块

const app = express();
const port = 5000 ;  // 设置服务器端口

app.use('/vpn', connectVPN);

// 启动服务器
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

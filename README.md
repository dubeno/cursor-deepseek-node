
安装node js v18.17.0
# 初始化
npm config set registry https://registry.npmmirror.com
npm init -y

# 安装依赖
npm install dotenv http2

设置.env文件中ds密钥
DEEPSEEK_API_KEY=sk-xx*************(自己申请的)

# 启动服务,http端口
node deepseek-proxy.js

#测试HTTP/1.1服务
curl http://localhost:9001/v1/models

#暴露内网为公网IP
https://www.cpolar.com/

#最终cursor 模型配置base url:
http://xxxx.cpolar.top

密钥保持与deepseek申请的一致

  

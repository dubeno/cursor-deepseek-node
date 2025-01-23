inspired by https://github.com/danilofalcao/cursor-deepseek
This is a nodejs version 

# install node js v18.17.0
https://nodejs.org/en/download
# set npm mirror for quick install
npm config set registry https://registry.npmmirror.com
# init project
npm init -y

# install dependency
npm install dotenv http2

#set deepseek api in .env
DEEPSEEK_API_KEY=sk-xx*************(yours)

# start proxy server on 9001
node deepseek-proxy.js

#test 
curl http://localhost:9001/v1/models

# use this one to get a public url for your local server, or cursor may complain with error。
https://www.cpolar.com/

# cursor model setting set openai base url and model use gpt-4o:
-- baseurl: http://xxxx.cpolar.top
-- apikey:your deepseek apikey


  

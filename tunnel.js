// 隧道守护：localtunnel 断开后自动重连，保持公网可访问
const localtunnel = require('localtunnel');

const PORT = 3000;
let currentUrl = null;

async function open() {
  try {
    const tunnel = await localtunnel({ port: PORT });
    currentUrl = tunnel.url;
    console.log('TUNNEL_URL=' + tunnel.url);
    tunnel.on('close', () => {
      console.log('TUNNEL_CLOSED，5秒后重连…');
      setTimeout(open, 5000);
    });
    tunnel.on('error', (e) => {
      console.log('TUNNEL_ERROR: ' + (e && e.message));
    });
  } catch (e) {
    console.log('TUNNEL_OPEN_FAILED: ' + e.message + '，5秒后重试…');
    setTimeout(open, 5000);
  }
}

// 每 60 秒打印一次当前地址，便于观察存活状态
setInterval(() => {
  if (currentUrl) console.log('TUNNEL_ALIVE=' + currentUrl);
}, 60000);

open();

// UI 关闭路径验收用进程，只发送公开状态协议，无模型调用或对话正文。
process.stdout.write('\x1b]7501;state=idle:app=codex\x1b\\');
console.log('工作台关闭与恢复失败路径验收；不连接模型。');
setTimeout(()=>process.exit(3),12000);

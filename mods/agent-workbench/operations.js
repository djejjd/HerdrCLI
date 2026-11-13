// 跨进程启动统一校验：失败带阶段，创建成功后名称同步失败不再次创建。
export async function createConversation(exec, args) {
  const {spaceName,machine,...tab}=args;
  const command=spaceName?'space.new':'tab.new';
  const payload=spaceName?{name:spaceName,tab:tab.name,folder:tab.folder,argv:tab.argv,machine}:tab;
  const response=await exec('herdr-app',['do',command,JSON.stringify(payload)]);
  if(response.code!==0)throw new Error('launch');
  let created;
  try{created=JSON.parse(response.stdout);}catch{throw new Error('response');}
  if(created.error||!created.terminal)throw new Error('response');
  return created;
}

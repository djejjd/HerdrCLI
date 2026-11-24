import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);
const call = async args => (await execute('hc',args,{timeout:2500,maxBuffer:4*1024*1024})).stdout;
const [action,address] = process.argv.slice(2);
try {
  if (action === 'list') {
    const groups = await Promise.all(['chat','task'].map(async kind => JSON.parse(await call(['ls','--all','--json','--label','workbench.child.kind='+kind])).terminals));
    const rows = groups.flat().filter(term => term.state === 'finished').slice(-128);
    const history = [];
    for (let index=0;index<rows.length;index+=8) {
      const batch = await Promise.allSettled(rows.slice(index,index+8).map(async row => {
        const term = JSON.parse(await call(['get',row.address]));
        return {address:term.address,parent:term.parent,name:term.labels?.['workbench.name'],exit:term.exit_code,received:term.labels?.['workbench.child.received']==='yes'};
      }));
      history.push(...batch.filter(item => item.status==='fulfilled').map(item=>item.value));
    }
    console.log(JSON.stringify(history));
  } else if (action === 'read' && /^t[a-z0-9]+$/.test(address)) {
    const text = await call(['read','--lines','120',address]);
    console.log(JSON.stringify(text.slice(-16000)));
  } else throw Error();
} catch { console.error('子任务记录读取失败'); process.exitCode=1; }

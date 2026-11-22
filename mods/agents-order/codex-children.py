"""只读适配本机 Codex，以进程及启动时间确认唯一父会话。"""
from contextlib import closing
import datetime
import hashlib
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path.home() / '.codex'


def state_of(path, edge):
    if not isinstance(path, str) or not path:
        return 'unknown'
    try:
        with open(path, 'rb') as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 65536))
            lines = stream.read().splitlines()
        for line in reversed(lines):
            try:
                event = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(event, dict) or event.get('type') != 'event_msg':
                continue
            payload = event.get('payload')
            if not isinstance(payload, dict) or not isinstance(payload.get('type'), str):
                return 'unknown'
            kind = payload['type']
            if kind == 'task_complete':
                return 'completed'
            if kind == 'turn_aborted':
                return 'idle'
            if kind == 'task_started':
                return 'idle' if edge == 'closed' else 'working'
    except (OSError, ValueError):
        pass
    return 'unknown'


def snapshot(pid):
    stage = 'process'
    identity = {}
    try:
        started = subprocess.check_output(['ps','-p',str(pid),'-o','lstart='],timeout=1,text=True).strip()
        start = int(datetime.datetime.strptime(started,'%a %b %d %H:%M:%S %Y').timestamp())
        stage = 'identity'
        with closing(sqlite3.connect((ROOT/'logs_2.sqlite').as_uri()+'?mode=ro',uri=True,timeout=.5)) as db:
            db.execute('ATTACH DATABASE ? AS st',((ROOT/'state_5.sqlite').as_uri()+'?mode=ro',))
            parents = db.execute("SELECT DISTINCT t.id,t.rollout_path FROM logs l JOIN st.threads t ON t.id=l.thread_id WHERE l.process_uuid LIKE ? AND l.ts>=? AND (t.thread_source='user' OR (t.thread_source IS NULL AND t.source='cli')) LIMIT 2",(f'pid:{pid}:%',start)).fetchall()
            if len(parents)!=1:
                return {'stage':stage,'children':[]}
            parent_id, parent_path = parents[0]
            # 用父线程、进程及启动时间生成不可直接读出原始标识的比较值。
            identity = {'identity':hashlib.sha256(f'{pid}:{start}:{parent_id}'.encode()).hexdigest()[:32]}
            stage = 'children'
            rows = db.execute('SELECT t.id,t.agent_path,t.model,t.rollout_path,e.status,t.updated_at_ms FROM st.thread_spawn_edges e JOIN st.threads t ON t.id=e.child_thread_id WHERE e.parent_thread_id=? ORDER BY t.created_at DESC LIMIT 16',(parent_id,)).fetchall()
            children = [dict(id=i,name=(name if isinstance(name,str) and name else 'Agent').split('/')[-1],
                             model=model if isinstance(model,str) else '',state=state_of(path,edge),revision=revision)
                        for i,name,model,path,edge,revision in rows if isinstance(i,str)]
            return {'stage':'ready',**identity,'parentState':state_of(parent_path,'open'),'children':children}
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError):
        return {'stage':stage,**identity,'children':[]}

if __name__ == '__main__':
    for_pid = [int(value) for value in sys.argv[1:17] if value.isdigit()]
    print(json.dumps({pid:dict(version=1,pid=pid,**snapshot(pid)) for pid in for_pid}))

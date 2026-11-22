"""只读适配本机 Codex，以进程及启动时间确认唯一父会话。"""
import datetime
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path.home() / '.codex'


def state_of(path, edge):
    if edge == 'closed':
        return 'idle'
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
            if event.get('type') != 'event_msg':
                continue
            kind = event['payload'].get('type')
            if kind in ('task_complete','turn_aborted'):
                return 'idle'
            if kind == 'task_started':
                return 'working'
    except OSError:
        pass
    return 'unknown'


def snapshot(pid):
    stage = 'process'
    try:
        started = subprocess.check_output(['ps','-p',str(pid),'-o','lstart='],timeout=1,text=True).strip()
        start = int(datetime.datetime.strptime(started,'%a %b %d %H:%M:%S %Y').timestamp())
        stage = 'identity'
        with sqlite3.connect((ROOT/'logs_2.sqlite').as_uri()+'?mode=ro',uri=True,timeout=.5) as db:
            db.execute('ATTACH DATABASE ? AS st',((ROOT/'state_5.sqlite').as_uri()+'?mode=ro',))
            parents = db.execute("SELECT DISTINCT t.id FROM logs l JOIN st.threads t ON t.id=l.thread_id WHERE l.process_uuid LIKE ? AND l.ts>=? AND (t.thread_source='user' OR (t.thread_source IS NULL AND t.source='cli')) LIMIT 2",(f'pid:{pid}:%',start)).fetchall()
            if len(parents)!=1:
                return {'stage':stage,'children':[]}
            stage = 'children'
            rows = db.execute('SELECT t.id,t.agent_path,t.model,t.rollout_path,e.status FROM st.thread_spawn_edges e JOIN st.threads t ON t.id=e.child_thread_id WHERE e.parent_thread_id=? ORDER BY t.created_at DESC LIMIT 16',parents[0]).fetchall()
            return {'stage':'ready','children':[dict(id=i,name=(name or 'Agent').split('/')[-1],model=model,state=state_of(path,edge)) for i,name,model,path,edge in rows]}
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError):
        return {'stage':stage,'children':[]}

if __name__ == '__main__':
    for_pid = [int(value) for value in sys.argv[1:17] if value.isdigit()]
    print(json.dumps({pid:dict(version=1,pid=pid,**snapshot(pid)) for pid in for_pid}))

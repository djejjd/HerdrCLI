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
READ_BLOCK = 64 * 1024
ROLLOUT_LIMIT = 4 * 1024 * 1024
BATCH_LIMIT = 32 * 1024 * 1024


class ScanBudget:
    """同一次探测的父子会话共享字节预算。"""

    def __init__(self):
        self.remaining = BATCH_LIMIT


def rollout_lines(stream, budget):
    """反向读出完整 JSONL 行；扫描边界落在一行中间时不解析残片。"""
    stream.seek(0, 2)
    cursor = stream.tell()
    floor = max(0, cursor - min(ROLLOUT_LIMIT, budget.remaining))
    fragments = []
    while cursor > floor:
        length = min(cursor - floor, READ_BLOCK)
        cursor -= length
        stream.seek(cursor)
        chunk = stream.read(length)
        budget.remaining -= length
        if len(chunk) != length:
            raise OSError('rollout changed while reading')
        lines = chunk.split(b'\n')
        if len(lines) == 1:
            fragments.append(lines[0])
            continue
        yield b''.join([lines[-1], *reversed(fragments)])
        yield from reversed(lines[1:-1])
        fragments = [lines[0]]
    if cursor == 0:
        yield b''.join(reversed(fragments))


def state_of(path, edge, budget=None):
    if not isinstance(path, str) or not path:
        return 'unknown', None
    if budget is None:
        budget = ScanBudget()
    if not budget.remaining:
        return 'unknown', None
    try:
        with open(path, 'rb') as stream:
            return latest_state(rollout_lines(stream, budget), edge)
    except (OSError, ValueError):
        return 'unknown', None


def latest_state(lines, edge):
    """只读取状态事件与完成轮次，输出状态和不可直接读出的轮次版本。"""
    for line in lines:
        if b'"event_msg"' not in line:
            continue
        try:
            event = json.loads(line)
        except (ValueError, RecursionError):
            continue
        if not isinstance(event, dict) or event.get('type') != 'event_msg':
            continue
        payload = event.get('payload')
        if not isinstance(payload, dict) or not isinstance(payload.get('type'), str):
            return 'unknown', None
        kind = payload['type']
        if kind == 'task_complete':
            turn = payload.get('turn_id')
            # 回执绑定真实完成轮次，即使 SQLite 更新时间未变化或尚未落库。
            revision = None
            if isinstance(turn, str) and turn and not payload.get('error'):
                revision = int(hashlib.sha256(turn.encode()).hexdigest()[:13], 16) or 1
            return 'completed', revision
        if kind == 'turn_aborted':
            return 'idle', None
        if kind == 'task_started':
            return ('idle' if edge == 'closed' else 'working'), None
    return 'unknown', None


def snapshot(pid, budget=None):
    if budget is None:
        budget = ScanBudget()
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
            rows = db.execute('SELECT t.id,t.agent_path,t.model,t.rollout_path,e.status FROM st.thread_spawn_edges e JOIN st.threads t ON t.id=e.child_thread_id WHERE e.parent_thread_id=? ORDER BY t.created_at DESC LIMIT 16',(parent_id,)).fetchall()
            parent_state, parent_revision = state_of(parent_path,'open',budget)
            children = []
            for child_id,name,model,path,edge in rows:
                if not isinstance(child_id,str):
                    continue
                state, revision = state_of(path,edge,budget)
                children.append(dict(id=child_id,name=(name if isinstance(name,str) and name else 'Agent').split('/')[-1],
                                     model=model if isinstance(model,str) else '',state=state,revision=revision))
            return {'stage':'ready',**identity,'parentState':parent_state,'parentRevision':parent_revision,'children':children}
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError):
        return {'stage':stage,**identity,'children':[]}

if __name__ == '__main__':
    for_pid = [int(value) for value in sys.argv[1:17] if value.isdigit()]
    budget = ScanBudget()
    print(json.dumps({pid:dict(version=1,pid=pid,**snapshot(pid,budget)) for pid in for_pid}))

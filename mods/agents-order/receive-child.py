"""在父 Herdr 会话核实临时子任务完成版本，并登记只影响显示的回执。"""
import fcntl
import json
import os
import re
import runpy
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

CHILDREN = 'workbench.children.v1'
RECEIVED = 'workbench.received.v1'
LIMIT = 8192
MAX_SAFE = 2 ** 53 - 1
IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,79}')
ADDRESS = re.compile(r't[a-z0-9]+')


class ReceiptError(Exception):
    """只向调用方报告固定失败阶段。"""


def integer(value):
    return type(value) is int and 0 < value <= MAX_SAFE


def read_json(content, stage):
    try:
        value = json.loads(content)
    except (ValueError, TypeError):
        raise ReceiptError(stage) from None
    if not isinstance(value, dict):
        raise ReceiptError(stage)
    return value


def hc(stage, *args):
    try:
        return subprocess.run(['hc', *args], check=True, capture_output=True, text=True, timeout=4).stdout
    except (OSError, UnicodeError, subprocess.SubprocessError):
        raise ReceiptError(stage) from None


def current_snapshot(address):
    terminal = read_json(hc('terminal', 'get', address, '--json'), 'terminal')
    foreground = terminal.get('foreground')
    created = terminal.get('created_ms')
    if terminal.get('address') != address or terminal.get('state') != 'live' or not integer(created) \
            or not isinstance(foreground, dict) or not integer(foreground.get('pid')):
        raise ReceiptError('terminal')
    pid = foreground['pid']
    labels = terminal.get('labels') or {}
    if not isinstance(labels, dict):
        raise ReceiptError('snapshot')
    if CHILDREN in labels:
        published = labels[CHILDREN]
        if not isinstance(published, str) or len(published) > LIMIT:
            raise ReceiptError('snapshot')
        snapshot = read_json(published, 'snapshot')
    elif foreground.get('name') == 'codex':
        try:
            read_native = runpy.run_path(str(Path(__file__).with_name('codex-children.py')))['snapshot']
        except (OSError, KeyError):
            raise ReceiptError('snapshot') from None
        snapshot = {'version': 1, 'pid': pid, **read_native(pid)}
    else:
        raise ReceiptError('snapshot')
    identity = snapshot.get('identity')
    children = snapshot.get('children')
    if snapshot.get('version') != 1 or snapshot.get('pid') != pid or snapshot.get('stage', 'ready') != 'ready' \
            or not isinstance(identity, str) or not IDENTIFIER.fullmatch(identity) or not isinstance(children, list):
        raise ReceiptError('snapshot')
    parent = {'address': address, 'createdMs': created, 'pid': pid, 'identity': identity}
    return parent, labels, [item for item in children[:16] if isinstance(item, dict)]


def current_child(address, child_id, revision):
    parent, labels, children = current_snapshot(address)
    matched = [item for item in children if item.get('id') == child_id]
    if len(matched) != 1 or not eligible(matched[0], revision):
        raise ReceiptError('child')
    return parent, labels


def eligible(item, revision):
    if item.get('state') != 'completed' or not integer(item.get('revision')) or item['revision'] != revision:
        return False
    lifecycle = item.get('lifecycle')
    return lifecycle is None or (
        isinstance(lifecycle, dict) and lifecycle.get('kind') == 'temporary'
        and all(lifecycle.get(field) is None or lifecycle[field] is False for field in ('pending', 'takeover', 'recovering'))
    )


def prior_receipts(labels, parent):
    raw = labels.get(RECEIVED)
    if not raw:
        return {}
    if not isinstance(raw, str) or len(raw) > LIMIT:
        raise ReceiptError('receipt')
    value = read_json(raw, 'receipt')
    if value.get('parent') != parent:
        return {}
    receipts = value.get('received')
    if value.get('version') != 1 or not isinstance(receipts, dict) \
            or any(not IDENTIFIER.fullmatch(key) or not integer(revision) for key, revision in receipts.items()):
        raise ReceiptError('receipt')
    return receipts


def save(address, child_id, revision):
    before, _ = current_child(address, child_id, revision)
    parent, labels = current_child(address, child_id, revision)
    if before != parent:
        raise ReceiptError('parent')
    receipts = prior_receipts(labels, parent)
    if receipts.get(child_id) == revision:
        return
    receipts[child_id] = revision
    value = json.dumps({'version': 1, 'parent': parent, 'received': receipts}, separators=(',', ':'))
    if len(value) > LIMIT:
        raise ReceiptError('receipt')
    hc('write', 'label', address, f'{RECEIVED}={value}', '--json')


def list_completions(address):
    _, _, children = current_snapshot(address)
    ids = [item.get('id') for item in children]
    completed = [{'id': item['id'], 'revision': item['revision']} for item in children
                 if isinstance(item.get('id'), str) and IDENTIFIER.fullmatch(item['id'])
                 and ids.count(item['id']) == 1 and eligible(item, item.get('revision'))]
    print(json.dumps(completed, separators=(',', ':')))


def main(args):
    try:
        address = os.environ.get('HC_TERMINAL_ID', '')
        if not ADDRESS.fullmatch(address):
            raise ReceiptError('terminal')
        if args == ['list']:
            list_completions(address)
            return 0
        if len(args) != 4 or set(args[2:]) != {'--temporary', '--no-pending'} or not IDENTIFIER.fullmatch(args[0]) \
                or not re.fullmatch(r'[0-9]{1,16}', args[1]) or not integer(int(args[1])):
            raise ReceiptError('arguments')
        lock_path = Path(tempfile.gettempdir()) / f'herdr-child-receipt-{os.getuid()}-{address}.lock'
        try:
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as lock:
                info = os.fstat(lock.fileno())
                if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode):
                    raise ReceiptError('lock')
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                save(address, args[0], int(args[1]))
        except OSError:
            raise ReceiptError('lock') from None
    except ReceiptError as error:
        print(f'receive-child: {error}', file=sys.stderr)
        return 1
    print('receive-child: recorded')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))

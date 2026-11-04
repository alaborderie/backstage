#!/usr/bin/env python3
"""Run a real sandbox agent using local credentials without printing their values."""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:17007').rstrip('/')


def request(path, body=None, token=None):
    headers = {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(base + '/api/' + path, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    if '/credentials/' in path:
        req.method = 'PUT'
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{req.method} {path}: HTTP {error.code}') from None


guest = request('auth/guest/refresh')['backstageIdentity']['token']
token = request('cloud-agents/me/tokens', {'name': 'local-image-check'}, guest)['token']
assert token.startswith('cat_')
entries = json.loads(subprocess.check_output(['opencode', 'auth', 'export', 'opencode-go']))
active = next(entry for entry in entries if entry['active'])
request('cloud-agents/me/credentials/opencode', {'value': active['value']['key']}, token)
github = subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
request('cloud-agents/me/credentials/github', {'value': github}, token)
print('PASS: cat_ token created; OpenCode and GitHub credentials stored through the API', flush=True)
agent = request('cloud-agents/agents', {
    'repo': 'alaborderie/cloud-agent-runner-sandbox',
    'tier': 'flash',
    'title': 'Backstage image integration proof',
    'prompt': 'Inspect README.md and report its first heading. Do not modify files, create branches, push, or open a pull request.',
}, token)
print('Agent:', agent['id'], flush=True)
for _ in range(180):
    agent = request('cloud-agents/agents/' + agent['id'], token=token)
    if agent['status'] in ('succeeded', 'failed', 'stopped', 'needs_input'):
        print(json.dumps(agent, indent=2))
        assert agent['status'] == 'succeeded', agent['status']
        break
    time.sleep(5)
else:
    raise TimeoutError('Agent did not finish in 15 minutes')

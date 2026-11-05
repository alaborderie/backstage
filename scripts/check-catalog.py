#!/usr/bin/env python3
"""Check the cluster and GitHub inventory a running Backstage serves."""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:17010').rstrip('/')
headers = {'X-Requested-With': 'XMLHttpRequest'}


def get(path):
    req = urllib.request.Request(base + path, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def entities():
    items, cursor = [], None
    while True:
        query = {'limit': '500', **({'cursor': cursor} if cursor else {})}
        page = get('/api/catalog/entities/by-query?' + urllib.parse.urlencode(query))
        items += page['items']
        cursor = page.get('pageInfo', {}).get('nextCursor')
        if not cursor:
            return items


def ref(entity):
    meta = entity['metadata']
    return f"{entity['kind'].lower()}:{meta.get('namespace', 'default')}/{meta['name']}"


headers['Authorization'] = 'Bearer ' + get('/api/auth/guest/refresh')['backstageIdentity']['token']

for _ in range(60):
    by_ref = {ref(e): e for e in entities()}
    if any(e['spec'].get('type') == 'ingress-route' for e in by_ref.values() if 'spec' in e):
        break
    time.sleep(5)
else:
    sys.exit('FAIL: no cluster entities after 5 minutes; read backend.log')

failures = []


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message)
    if not ok:
        failures.append(message)


def related(source, relation, target):
    return any(r['type'] == relation and r['targetRef'] == target
               for r in by_ref.get(source, {}).get('relations', []))


types = Counter((e['kind'], e.get('spec', {}).get('type')) for e in by_ref.values())
for (kind, kind_type), count in sorted(types.items(), key=str):
    print(f'{kind:10} {kind_type or "-":15} {count}')

for resource_type in ('namespace', 'ingress-route', 'database'):
    check(types[('Resource', resource_type)] > 0, f'Resources of type {resource_type}')
for component_type in ('api', 'frontend', 'bot', 'cronjob', 'worker', 'service'):
    check(types[('Component', component_type)] > 0, f'Components of type {component_type}')
print(f"INFO Components of type job: {types[('Component', 'job')]} (only standalone Jobs count)")

for owner in ('alaborderie', 'duscraft'):
    repos = [r for r, e in by_ref.items()
             if r.startswith(f'component:{owner}/') and e['spec'].get('type') == 'repository']
    check(len(repos) > 0, f'{len(repos)} repository components in namespace {owner}')

check(related('group:default/duscraft', 'hasMember', 'user:default/alaborderie')
      and related('user:default/alaborderie', 'memberOf', 'group:default/duscraft'),
      'user:default/alaborderie is a member of group:default/duscraft')

for name, slug in (('garry-api', 'duscraft/garry'), ('keyroll', 'alaborderie/keyroll'),
                   ('sfg-bot', 'alaborderie/sfg-bot'), ('pensee-api', 'duscraft/pensee')):
    component = by_ref.get(f'component:default/{name}', {})
    repo = 'component:' + slug
    linked = (component.get('metadata', {}).get('annotations', {}).get('github.com/project-slug') == slug
              and related(f'component:default/{name}', 'partOf', repo)
              and by_ref.get(repo, {}).get('spec', {}).get('type') == 'repository')
    if name == 'pensee-api' and not linked:
        print('INFO pensee-api unlinked until the GitHub App is installed on duscraft')
        continue
    check(linked, f'component:default/{name} carries {slug} and is a subcomponent of {repo}')

check(related('resource:default/garry-api-route', 'dependencyOf', 'component:default/garry-api'),
      'resource:default/garry-api-route is a dependency of component:default/garry-api')
for component, database in (('backstage', 'backstage-postgres'), ('garry-api', 'garry-postgres'),
                            ('garry-api', 'garry-redis')):
    check(related(f'component:default/{component}', 'dependsOn', f'resource:default/{database}'),
          f'component:default/{component} depends on resource:default/{database}')
check(related('component:default/garry-api', 'dependsOn', 'resource:default/default'),
      'component:default/garry-api relates to its namespace resource:default/default')

if failures:
    sys.exit(f'{len(failures)} check(s) failed')
print('PASS: catalog inventory')

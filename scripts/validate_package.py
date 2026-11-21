from pathlib import Path
import json,hashlib,re,sys,yaml
from jsonschema import Draft202012Validator
r=Path(__file__).resolve().parents[1];errors=[]
IGN={'.git','.idea','.vscode','node_modules','target','dist','build','coverage','playwright-report','test-results','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache'}
def rel(p):return p.relative_to(r).as_posix()
def ignored(p):return any(x in IGN for x in p.relative_to(r).parts) or p.name=='.env.local' or p.suffix.lower() in {'.pyc','.pyo'}
def load(p):
 try:return json.loads((r/p).read_text(encoding='utf-8'))
 except Exception as e:errors.append(f'invalid JSON {p}: {e}');return None
m=load('PACKAGE_MANIFEST.json')
if m:
 physical={rel(p) for p in r.rglob('*') if p.is_file() and not ignored(p)};listed={x['path'] for x in m['files']}
 for x in m['files']:
  p=r/x['path']
  if not p.exists():errors.append('missing '+x['path']);continue
  if x['sha256']!='SELF' and hashlib.sha256(p.read_bytes()).hexdigest()!=x['sha256']:errors.append('hash '+x['path'])
 for x in physical-listed:errors.append('unmanifested '+x)
try:
 api=yaml.safe_load((r/'openapi/openapi.yaml').read_text());
 if api['openapi']!='3.1.0':errors.append('OpenAPI version')
 mf=api['paths']['/v1/map/features']['get'];
 if not any(x.get('$ref','').endswith('/Bbox') for x in mf['parameters']):errors.append('map bbox missing')
 for ep in ['/health/live','/health/ready','/version']:
  if api['paths'][ep]['get'].get('security')!=[]:errors.append('public endpoint security '+ep)
 jp=api['paths']['/v1/authority/issues/{id}/jurisdiction']['post'];
 if not any(x.get('$ref','').endswith('/IfMatch') for x in jp['parameters']):errors.append('jurisdiction If-Match missing')
 for path,methods in api['paths'].items():
  for method,op in methods.items():
   if method not in {'get','post','put','patch','delete'}:continue
   if method!='get' and 'requestBody' not in op:errors.append('request body '+op['operationId'])
   if not all('$ref' in v or 'content' in v for v in op['responses'].values()):errors.append('untyped response '+op['operationId'])
except Exception as e:errors.append('OpenAPI '+str(e))
mp=load('config/seed-schema-map.json') or {}
for stem,sn in mp.items():
 sc=load(f'schemas/{sn}.schema.json');data=load(f'data/demo/{stem}.json') or []
 if sc:
  for rec in data:
   for e in Draft202012Validator(sc).iter_errors(rec):errors.append(f'schema {stem}/{rec.get("id")}: {e.message}')
sets={n:{x['id'] for x in (load(f'data/demo/{n}.json') or [])} for n in ['assets','budgets','contractors','contracts','work-orders','issues']}
for x in load('data/demo/contracts.json') or []:
 if x['budgetId'] not in sets['budgets'] or x['vendorId'] not in sets['contractors']:errors.append('contract FK '+x['id'])
for x in load('data/demo/work-orders.json') or []:
 if x['contractId'] not in sets['contracts'] or x['assetId'] not in sets['assets']:errors.append('work FK '+x['id'])
for x in load('data/demo/issues.json') or []:
 if x['assetId'] not in sets['assets'] or (x.get('workOrderId') and x['workOrderId'] not in sets['work-orders']):errors.append('issue FK '+x['id'])
# pages/trace
pages={x['pageId'] for x in (load('wireframes/pages.json') or {}).get('pages',[])};covered=set()
for x in (load('traceability/journeys.json') or {}).get('journeys',[]):covered.update(x['pageIds'])
if pages!=covered:errors.append('page coverage mismatch')
# contradictions
for x in (load('audit/CONTRADICTIONS.json') or {}).get('findings',[]):
 if x.get('severity')=='BLOCKER' and x.get('status')=='OPEN':errors.append('open contradiction '+x.get('id','?'))
# claim scan in implementation-facing content
allow={'GUARDRAILS.md','CLAIM_POLICY.md','LIMITATIONS.md','GEMINI_NARROW_CLOSURE_REVIEW_PROMPT.md'}
for p in list(r.rglob('*.tsx'))+list(r.rglob('*.json')):
 if ignored(p):continue
 t=p.read_text(encoding='utf-8',errors='ignore').lower()
 for q in ['official bmc integration','zero municipal repair cost','authenticated evidence','immutable audit history','contractor culpability']:
  if q in t:errors.append('prohibited claim '+q+' in '+rel(p))
if '--release' in sys.argv:
 pat=re.compile(r'\b(?:test|it|describe)\s*\.\s*(?:skip|todo|fixme)\s*\(');empty=re.compile(r'(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}')
 for p in r.rglob('*.spec.ts'):
  t=p.read_text(encoding='utf-8')
  if pat.search(t) or empty.search(t):errors.append('placeholder test '+rel(p))
if errors:
 print('PACKAGE INVALID');[print('-',x) for x in sorted(set(errors))];sys.exit(1)
print('PACKAGE VALID')

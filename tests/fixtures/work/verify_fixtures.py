#!/usr/bin/env python3
"""仅验证当前合成数据包，不执行目标应用或访问网络。"""
import hashlib,json,sys
from pathlib import Path
root=Path(__file__).resolve().parent
data=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
errors=[]
for item in data['files']:
 p=root/item['path']
 if not p.resolve().is_relative_to(root.resolve()):errors.append('越界路径');continue
 if not p.is_file():errors.append('缺失 '+item['path']);continue
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
 if digest!=item['sha256'] or p.stat().st_size!=item['bytes']:errors.append('校验失败 '+item['path'])
print(json.dumps({'dataset':data['dataset'],'verified_files':len(data['files']),'errors':errors,'product_test_status':'NOT_RUN'},ensure_ascii=False,indent=2))
sys.exit(bool(errors))

#!/bin/bash
# Downloads only by default. --copy explicitly copies to the installed app's data container.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_model_dir="${FIXLIST_VISION_MODEL_DIR:-$HOME/.local/share/fixlist-scan/vision-preload/qwen3-vl-2b-4bit}"
task_device="9694130A-ABE3-541A-BA55-8C0A73364F34"
task_copy=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --copy) task_copy=true; shift ;;
    --device) task_device="$2"; shift 2 ;;
    --model-dir) task_model_dir="$2"; shift 2 ;;
    --help) echo "Usage: $0 [--model-dir DIRECTORY] [--copy] [--device ID]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
python3 - "$task_root/scan/vision/model-manifest.json" "$task_model_dir" <<'PY'
import hashlib,json,os,subprocess,sys
from pathlib import Path
manifest=json.loads(Path(sys.argv[1]).read_text()); target=Path(sys.argv[2]).expanduser()
target.mkdir(parents=True,exist_ok=True)
def valid(path,item):
    if not path.is_file() or path.stat().st_size!=item['bytes']:return False
    with path.open('rb') as f:
        h=hashlib.file_digest(f,'sha256').hexdigest()
    return h==item['sha256']
for item in manifest['files']:
    path=target/item['name']
    if valid(path,item):print('Verified',item['name'],flush=True);continue
    partial=path.with_name(path.name+'.download')
    url=f'https://huggingface.co/{manifest["id"]}/resolve/{manifest["revision"]}/{item["name"]}'
    subprocess.run(['curl','--fail','--location','--retry','3','--continue-at','-','--output',str(partial),url],check=True)
    if not valid(partial,item):
        partial.unlink(missing_ok=True)
        raise SystemExit(f'Checksum/size failure: {item["name"]}. Run again to retry.')
    partial.replace(path)
print(f'Verified {manifest["id"]}@{manifest["revision"]}: {manifest["bytes"]} bytes at {target}',flush=True)
PY
task_destination="Library/Application Support/FixListVision/qwen3-vl-2b-4bit"
if [[ "$task_copy" == true ]]; then
  # Directory contents must appear directly inside qwen3-vl-2b-4bit, not a nested snapshot directory.
  xcrun devicectl device copy to --device "$task_device" --domain-type appDataContainer \
    --domain-identifier app.fixlist.demo --source "$task_model_dir" --destination "$task_destination"
else
  printf 'Downloaded and verified. To copy after the app is installed, run:\n'
  printf '%q --model-dir %q --copy --device %q\n' "$0" "$task_model_dir" "$task_device"
fi

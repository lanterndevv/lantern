# Proceso auxiliar de Lantern: carga Laya una vez y contesta JSON por líneas.
# Entrada:  {"id": 1, "state": "frase en inglés", "questions": {...}}
# Salida:   {"id": 1, "answers": {...}}  o  {"id": 1, "error": "..."}  (la primera línea es {"ready": true})
import json, os, sys, warnings

warnings.filterwarnings("ignore")
from laya import Router

r = Router(device=os.environ.get("LANTERN_LAYA_DEVICE", "cpu"))
r.preload(["english"])
print(json.dumps({"ready": True}), flush=True)
for raw in sys.stdin:
    try:
        req = json.loads(raw)
    except ValueError:
        continue
    try:
        out = {"id": req.get("id"), "answers": r.predict(req["state"], req["questions"])["answers"]}
    except Exception as e:  # una petición mala no debe tumbar el proceso
        out = {"id": req.get("id"), "error": str(e)[:200]}
    print(json.dumps(out), flush=True)
